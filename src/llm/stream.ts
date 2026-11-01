// One streaming model call per turn, with no automatic tool execution: the loop runs the tools itself. Retries are
// ours: rate limits, server errors and network failures get exponential backoff with jitter, honour Retry-After, and
// stop after 3 attempts. Once text has streamed, an error ends the turn with a message rather than retrying (pi-ai's
// model). The model's reasoning parts are read and discarded: no reasoning is stored or sent back.
import { jsonSchema, streamText, tool } from 'ai';
import type { JSONSchema7, ModelMessage, ToolSet } from 'ai';
import type { ChatModel } from './providers';
import type { WireEffort } from './catalogue';
import { errorText, getApiCallStatusCode, isRetryable, retryAfterMs, unwrapError } from './errors';
import { isContextOverflow } from './overflow';
import { withSlot } from './limiter';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Reasoning tokens, counted inside `output` as the providers count them. */
  reasoning?: number;
  cost?: number;
}

export interface ToolDefinition {
  description: string;
  /** JSON Schema of the arguments. */
  parameters: unknown;
}

export interface ToolCallRequest {
  toolCallId: string;
  toolName: string;
  input: unknown;
  /** The SDK could not parse or validate the call (unknown tool, bad JSON, schema mismatch). */
  invalid?: string;
  /** Provider metadata to send back with the call in history (Gemini 3's thought signature). */
  providerOptions?: Record<string, unknown>;
}

export type TurnFinish =
  'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'interrupted' | 'other' | 'aborted';

export interface TurnResult {
  text: string;
  reasoningText?: string;
  toolCalls: ToolCallRequest[];
  finish: TurnFinish;
  /** Null when the server reported no usage. */
  usage: TokenUsage | null;
  error?: { message: string; status?: number; overflow: boolean; network?: boolean };
  durationMs: number;
  attempts: number;
  /**
   * The server refused the reasoning option with a 400 that names it, and the request was sent again without it. The
   * caller stops sending the option for the rest of its run.
   */
  reasoningDropped?: boolean;
  /** The server refused None's value and took Low's (`noneRetry`) instead: the model refuses None. */
  noneRefused?: boolean;
  /** The server refused the images, and the request was sent again with each replaced by a note. */
  imagesDropped?: boolean;
  /** The SDK dropped the reasoning option itself, with a warning and no error. */
  reasoningIgnored?: boolean;
}

export interface RetryPolicy {
  attempts: number;
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseMs: 1000, maxMs: 30_000 };

export interface TurnRequest {
  chat: ChatModel;
  system: string;
  messages: ModelMessage[];
  tools?: Record<string, ToolDefinition>;
  /** Only these tools may be called, e.g. `done` alone for the salvage call. */
  toolChoice?: 'auto' | 'none' | 'required';
  maxOutputTokens?: number;
  /** The SDK's reasoning option, from the send rule; left out when undefined. */
  reasoning?: WireEffort;
  /** When `reasoning` is None's value: Low's, to try once if the server refuses None. */
  noneRetry?: WireEffort;
  /** False for Test models's probes: a refusal comes back as the error, with nothing sent again. */
  fallback?: false;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  retry?: RetryPolicy;
  /** For tests: how a retry waits. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function toToolSet(tools: Record<string, ToolDefinition>): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      tool({ description: t.description, inputSchema: jsonSchema(t.parameters as JSONSchema7) }),
    ]),
  );
}

export function normalizeToolInput(toolName: string, raw: unknown): Record<string, unknown> {
  const input =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  if (typeof raw === 'string') {
    if (toolName === 'navigate') return { url: raw };
    if (toolName === 'click' || toolName === 'read' || toolName === 'hover') return { target: { ref: raw } };
    if (toolName === 'ask_user') return { question: raw };
    if (toolName === 'done') return { outcome: 'success', summary: raw };
    return { value: raw };
  }
  if (toolName === 'click' || toolName === 'hover' || toolName === 'read' || toolName === 'set') {
    if (input.ref && !input.target) {
      input.target = { ref: String(input.ref) };
      delete input.ref;
    } else if (typeof input.target === 'string') {
      input.target = { ref: input.target };
    }
  }
  if (toolName === 'done') {
    if (!input.outcome) input.outcome = 'success';
    if (!input.summary && input.text) {
      input.summary = input.text;
      delete input.text;
    }
  }
  if (toolName === 'ask_user') {
    if (!input.question && input.text) {
      input.question = input.text;
      delete input.text;
    }
  }
  return input;
}

export function parseRelaxedJson(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  if (!s) return {};

  try {
    return JSON.parse(s);
  } catch {
    // try relaxed parsing
  }

  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      const relaxed = s
        .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*:/g, '$1"$2":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
        .replace(/\bNone\b/g, 'null');
      return JSON.parse(relaxed);
    } catch {
      // try assignment syntax
    }
  }

  if (/^[a-zA-Z_$][a-zA-Z0-9_$-]*\s*=/.test(s)) {
    try {
      const wrapped = '{' + s.replace(/([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*=/g, '"$1":') + '}';
      const relaxed = wrapped
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
        .replace(/\bNone\b/g, 'null');
      return JSON.parse(relaxed);
    } catch {
      // try string match
    }
  }

  const strMatch = /^["'](.*)["']$/.exec(s);
  if (strMatch) {
    return strMatch[1];
  }

  return null;
}

function cleanUrl(raw: string): string {
  let url = raw.trim().replace(/[»"'`\]),.]+$/, '');
  try {
    const parsed = new URL(url);
    if (parsed.search && /(?:%[0-9a-fA-F]{2}){8,}/.test(parsed.search)) {
      url = `${parsed.origin}${parsed.pathname}`;
    }
  } catch {
    // invalid URL format, ignore
  }
  return url;
}

export function extractToolCallsFromText(rawText: string, tools: Record<string, ToolDefinition>): ToolCallRequest[] {
  const text = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || rawText.trim();
  const known = new Set(Object.keys(tools));
  const results: ToolCallRequest[] = [];

  const tryAdd = (obj: unknown): boolean => {
    if (!obj) return false;
    if (Array.isArray(obj)) {
      let addedAny = false;
      for (const item of obj) {
        if (tryAdd(item)) addedAny = true;
      }
      return addedAny;
    }
    if (typeof obj !== 'object') return false;
    const record = obj as Record<string, unknown>;
    const funcRecord = (record.function && typeof record.function === 'object' ? record.function : undefined) as
      Record<string, unknown> | undefined;
    const name = record.name || funcRecord?.name || record.tool;
    let args = record.arguments || funcRecord?.arguments || record.args || record.parameters || {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        // keep string
      }
    }
    if (name && typeof name === 'string' && known.has(name)) {
      results.push({
        toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
        toolName: name,
        input: normalizeToolInput(name, args),
      });
      return true;
    }
    return false;
  };

  // 1. Tag format: <tool_call>...</tool_call>
  const tags = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/g);
  if (tags) {
    for (const t of tags) {
      const clean = t.replace(/<\/?tool_call>/g, '').trim();
      const parsed = parseRelaxedJson(clean);
      if (parsed) tryAdd(parsed);
    }
    if (results.length > 0) return results;
  }

  // 2. Direct JSON or code block
  const stripped = text
    .trim()
    .replace(/^```(?:json|javascript|js|python|py)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const directParsed = parseRelaxedJson(stripped);
  if (directParsed && tryAdd(directParsed)) return results;

  // 3. Function call syntax: tool_name(...)
  for (const name of known) {
    const regex = new RegExp(`(?:^|[\\s\`(\\[;]|call:|tool:)${name}\\s*\\(`, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const openParenIndex = text.indexOf('(', match.index);
      if (openParenIndex === -1) continue;
      const startArgs = openParenIndex + 1;
      let depth = 1;
      let inString: string | null = null;
      let endArgs = -1;
      for (let i = startArgs; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          if (ch === '\\') {
            i++;
            continue;
          }
          if (ch === inString) inString = null;
        } else {
          if (ch === '"' || ch === "'" || ch === '`') inString = ch;
          else if (ch === '(') depth++;
          else if (ch === ')') {
            depth--;
            if (depth === 0) {
              endArgs = i;
              break;
            }
          }
        }
      }
      if (endArgs !== -1) {
        const rawArgs = text.slice(startArgs, endArgs).trim();
        const parsed = parseRelaxedJson(rawArgs);
        if (parsed !== null) {
          results.push({
            toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
            toolName: name,
            input: normalizeToolInput(name, parsed),
          });
        }
      }
    }
  }
  if (results.length > 0) return results;

  // 4. Embedded JSON object
  const matches = text.match(/\{[\s\S]*?"(?:name|tool)"\s*:\s*"[^"]+"[\s\S]*?\}/g);
  if (matches) {
    for (const m of matches) {
      const parsed = parseRelaxedJson(m);
      if (parsed) tryAdd(parsed);
    }
  }

  // 5. Line calls: ask_user: ...
  const askMatch = /(?:^|\n)\s*ask_user\s*:\s*(.+)(?:\n|$)/i.exec(text);
  if (askMatch && known.has('ask_user')) {
    let q = askMatch[1].trim();
    if ((q.startsWith('"') && q.endsWith('"')) || (q.startsWith("'") && q.endsWith("'"))) {
      q = q.slice(1, -1);
    }
    results.push({
      toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
      toolName: 'ask_user',
      input: { question: q },
    });
  }

  // 6. Bare or shorthand line calls
  if (known.has('snapshot') && /(?:^|\n)\s*(?:call:|tool:)?\s*`*snapshot(?:\(\))?`*[\s.;]*(?:\n|$)/i.test(text)) {
    results.push({
      toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
      toolName: 'snapshot',
      input: {},
    });
    return results;
  }

  const clickLineMatch = /(?:^|\n)\s*(?:call:|tool:)?\s*`*click\s+\[?([a-zA-Z0-9_-]+)\]?`*[\s.;]*(?:\n|$)/i.exec(text);
  if (clickLineMatch && known.has('click')) {
    results.push({
      toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
      toolName: 'click',
      input: { target: { ref: clickLineMatch[1] } },
    });
    return results;
  }

  const readLineMatch = /(?:^|\n)\s*(?:call:|tool:)?\s*`*read\s+\[?([a-zA-Z0-9_-]+)\]?`*[\s.;]*(?:\n|$)/i.exec(text);
  if (readLineMatch && known.has('read')) {
    results.push({
      toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
      toolName: 'read',
      input: { target: { ref: readLineMatch[1] } },
    });
    return results;
  }

  if (known.has('navigate')) {
    const navMatch = /(?:navigate(?:\s+to)?|goto|open|url:?)\s*[:=]?\s*[`"'(«]?\s*(https?:\/\/[^\s`"'»)\],]+)/i.exec(
      text,
    );
    if (navMatch) {
      results.push({
        toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
        toolName: 'navigate',
        input: { url: cleanUrl(navMatch[1]) },
      });
      return results;
    }
    const bracketUrl = /«(https?:\/\/[^»\s]+)»/.exec(text);
    if (bracketUrl) {
      results.push({
        toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
        toolName: 'navigate',
        input: { url: cleanUrl(bracketUrl[1]) },
      });
      return results;
    }
    const mdLink = /\[(?:[^\]]*)\]\((https?:\/\/[^\s)]+)\)/.exec(text);
    if (mdLink) {
      results.push({
        toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
        toolName: 'navigate',
        input: { url: cleanUrl(mdLink[1]) },
      });
      return results;
    }
  }

  return results;
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function backoffMs(attempt: number, policy: RetryPolicy, error: unknown, random = Math.random): number {
  const asked = retryAfterMs(error);
  if (asked !== undefined) return Math.min(asked, policy.maxMs);
  const exp = policy.baseMs * 2 ** (attempt - 1);
  return Math.min(policy.maxMs, exp / 2 + random() * (exp / 2));
}

export function toUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
  raw?: unknown;
}): TokenUsage | null {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return null;
  // Cost only when the provider reports it.
  const cost = (usage.raw as { cost?: unknown } | undefined)?.cost;
  const reasoning = usage.outputTokenDetails?.reasoningTokens;
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    ...(reasoning ? { reasoning } : {}),
    ...(typeof cost === 'number' && cost >= 0 ? { cost } : {}),
  };
}

/**
 * A 400 that names the reasoning option: the server did not take it, the field or that value. On every kind, because
 * a first-party model can be guessed too.
 */
export function refusesReasoning(status: number | undefined, message: string): boolean {
  return status === 400 && /reasoning|thinking|effort/i.test(message);
}

/** A 400 that names an image: the model does not take images. */
export function refusesImages(status: number | undefined, message: string): boolean {
  return status === 400 && /image|vision|multimodal/i.test(message);
}

/** The note an image is replaced with when the model refused images. */
export const IMAGE_NOT_SENT = '[An image was here; this model does not take images.]';

const isImagePart = (part: unknown) => {
  const p = part as { type?: string; mediaType?: string };
  return p?.type === 'image' || (p?.type === 'file' && !!p.mediaType?.startsWith('image/'));
};

/** The messages with each image replaced by a short note; null when there was none. */
export function withoutImages(messages: ModelMessage[]): ModelMessage[] | null {
  let found = false;
  const out = messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    const content = (m.content as unknown[]).map(part => {
      if (!isImagePart(part)) return part;
      found = true;
      return { type: 'text', text: IMAGE_NOT_SENT };
    });
    return { ...m, content } as ModelMessage;
  });
  return found ? out : null;
}

/** Runs one turn: streams the reply, collects its tool calls, retries before anything streamed. */
export async function streamTurn(request: TurnRequest): Promise<TurnResult> {
  const { maxConcurrent, baseUrl, kind } = request.chat.spec;
  if (!maxConcurrent) return streamTurnNow(request);
  try {
    return await withSlot(`${kind} ${baseUrl ?? ''}`, maxConcurrent, () => streamTurnNow(request), request.signal);
  } catch {
    return { text: '', toolCalls: [], finish: 'aborted', usage: null, durationMs: 0, attempts: 0 };
  }
}

async function streamTurnNow(request: TurnRequest): Promise<TurnResult> {
  const policy = request.retry ?? DEFAULT_RETRY;
  const sleep = request.sleep ?? sleepFor;
  const start = Date.now();
  const tools = request.tools && Object.keys(request.tools).length ? toToolSet(request.tools) : undefined;
  let attempt = 0;
  let reasoning = request.reasoning;
  let reasoningDropped = false;
  let noneRetry = request.noneRetry;
  let noneRefused = false;
  let messages = request.messages;
  let imagesDropped = false;
  let reasoningIgnored = false;
  for (;;) {
    attempt++;
    let text = '';
    let reasoningText = '';
    let started = false;
    const toolCalls: ToolCallRequest[] = [];
    let finish: TurnFinish = 'other';
    let usage: TokenUsage | null = null;
    let failure: unknown;
    try {
      const result = streamText({
        model: request.chat.model,
        system: request.system,
        messages,
        tools,
        toolChoice: tools ? (request.toolChoice ?? 'auto') : undefined,
        maxOutputTokens: request.maxOutputTokens ?? request.chat.spec.maxOutputTokens,
        ...(reasoning ? { reasoning } : {}),
        maxRetries: 0,
        abortSignal: request.signal,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerOptions: request.chat.providerOptions as any,
        onError: () => undefined,
      });
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta': {
            started = true;
            text += part.text;
            request.onTextDelta?.(part.text);
            break;
          }
          case 'reasoning-delta': {
            started = true;
            const deltaPart = part as { text?: string; reasoningText?: string; textDelta?: string };
            const delta = deltaPart.text ?? deltaPart.reasoningText ?? deltaPart.textDelta ?? '';
            reasoningText += delta;
            break;
          }
          case 'tool-call': {
            started = true;
            const invalid = 'invalid' in part && part.invalid ? errorText(part.error) : undefined;
            toolCalls.push({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
              ...(invalid ? { invalid } : {}),
              ...(part.providerMetadata ? { providerOptions: part.providerMetadata } : {}),
            });
            break;
          }
          case 'start-step':
            if (part.warnings.some(w => /reasoning|effort|thinking/i.test(JSON.stringify(w)))) reasoningIgnored = true;
            break;
          case 'finish-step':
            usage = toUsage(part.usage);
            break;
          case 'finish':
            finish = part.finishReason;
            usage = usage ?? toUsage(part.totalUsage);
            break;
          case 'abort':
            finish = 'aborted';
            break;
          case 'error':
            failure = part.error;
            break;
        }
      }
    } catch (error) {
      failure = error;
    }
    if (request.signal?.aborted) {
      return { text, toolCalls: [], finish: 'aborted', usage, durationMs: Date.now() - start, attempts: attempt };
    }
    if (failure === undefined) {
      if (toolCalls.length === 0 && request.tools) {
        if (text.trim()) {
          const extracted = extractToolCallsFromText(text, request.tools);
          if (extracted.length > 0) {
            toolCalls.push(...extracted);
            text = '';
            finish = 'tool-calls';
          }
        }
        if (toolCalls.length === 0 && reasoningText.trim()) {
          const fromReasoning = extractToolCallsFromText(reasoningText, request.tools);
          if (fromReasoning.length > 0) {
            toolCalls.push(...fromReasoning);
            text = '';
            finish = 'tool-calls';
          } else if (!text.trim()) {
            text = reasoningText.replace(/<\/?think>/gi, '').trim();
          }
        }
      }
      const cost = usage && usage.cost === undefined ? await request.chat.takeCost?.() : undefined;
      if (usage && cost !== undefined) usage = { ...usage, cost };
      if (!reasoningText.trim()) {
        const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
        if (thinkMatch) {
          reasoningText = thinkMatch[1].trim();
          text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        }
      }
      const turnResult: TurnResult = {
        text,
        toolCalls,
        finish,
        usage,
        durationMs: Date.now() - start,
        attempts: attempt,
        ...(reasoningDropped ? { reasoningDropped } : {}),
        ...(noneRefused && !reasoningDropped ? { noneRefused } : {}),
        ...(imagesDropped ? { imagesDropped } : {}),
        ...(reasoningIgnored ? { reasoningIgnored } : {}),
      };
      if (reasoningText.trim()) {
        Object.defineProperty(turnResult, 'reasoningText', {
          value: reasoningText.trim(),
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }
      return turnResult;
    }
    // The same request once more, not counted as an attempt: at Low's value when None's was refused, without the option
    // when a value was refused, or without its images when they were.
    const status = getApiCallStatusCode(failure);
    const fallback = !started && request.fallback !== false;
    if (fallback && reasoning !== undefined && refusesReasoning(status, errorText(failure))) {
      if (noneRetry !== undefined) {
        reasoning = noneRetry;
        noneRetry = undefined;
        noneRefused = true;
      } else {
        reasoning = undefined;
        reasoningDropped = true;
      }
      attempt--;
      continue;
    }
    const stripped = fallback && refusesImages(status, errorText(failure)) ? withoutImages(messages) : null;
    if (stripped) {
      messages = stripped;
      imagesDropped = true;
      attempt--;
      continue;
    }
    if (!started && attempt < policy.attempts && isRetryable(failure)) {
      await sleep(backoffMs(attempt, policy, failure), request.signal);
      if (request.signal?.aborted) {
        return { text, toolCalls: [], finish: 'aborted', usage, durationMs: Date.now() - start, attempts: attempt };
      }
      continue;
    }
    return {
      text,
      // A reply that failed part way runs none of its calls.
      toolCalls: [],
      finish: 'error',
      usage,
      error: {
        message: errorText(failure),
        status: getApiCallStatusCode(failure),
        overflow: isContextOverflow(failure),
        // fetch rejects with a TypeError when the network fails.
        network: unwrapError(failure) instanceof TypeError,
      },
      durationMs: Date.now() - start,
      attempts: attempt,
      ...(reasoningDropped ? { reasoningDropped } : {}),
      ...(imagesDropped ? { imagesDropped } : {}),
    };
  }
}
