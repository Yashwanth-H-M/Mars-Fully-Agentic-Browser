import { describe, expect, it } from 'vitest';
import { APICallError } from 'ai';
import { ScriptedModel } from '../scripted';
import { backoffMs, DEFAULT_RETRY, extractToolCallsFromText, streamTurn } from '../stream';

const tools = {
  click: { description: 'Click', parameters: { type: 'object', properties: { ref: { type: 'string' } } } },
};

function apiError(status: number, body = '', headers: Record<string, string> = {}) {
  return new APICallError({
    message: `HTTP ${status}`,
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode: status,
    responseBody: body,
    responseHeaders: headers,
  });
}

const noSleep = async () => undefined;

describe('streamTurn', () => {
  it('streams text and collects tool calls without running them', async () => {
    const scripted = new ScriptedModel([{ text: 'Clicking.', toolCalls: [{ name: 'click', input: { ref: 'e1' } }] }]);
    const deltas: string[] = [];
    const result = await streamTurn({
      chat: scripted.chat(),
      system: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      tools,
      onTextDelta: d => deltas.push(d),
    });
    expect(result.text).toBe('Clicking.');
    expect(deltas.join('')).toBe('Clicking.');
    expect(result.toolCalls).toEqual([{ toolCallId: 'call_1', toolName: 'click', input: { ref: 'e1' } }]);
    expect(result.finish).toBe('tool-calls');
    expect(result.usage).toMatchObject({ input: 100, output: 10 });
    expect(scripted.calls[0].tools.map(t => t.name)).toEqual(['click']);
  });

  it('reports the output limit, so the loop can fail the calls of a cut reply', async () => {
    const scripted = new ScriptedModel([{ toolCalls: [{ name: 'click', input: { ref: 'e1' } }], finish: 'length' }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      tools,
    });
    expect(result.finish).toBe('length');
  });

  it('marks a call to an unknown tool as invalid', async () => {
    const scripted = new ScriptedModel([{ toolCalls: [{ name: 'eval', input: { code: '1' } }] }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      tools,
    });
    expect(result.toolCalls[0].toolName).toBe('eval');
    expect(result.toolCalls[0].invalid).toBeTruthy();
  });

  it('retries a rate limit and a server error, then succeeds', async () => {
    const scripted = new ScriptedModel([{ error: apiError(429) }, { error: apiError(503) }, { text: 'ok' }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      sleep: noSleep,
    });
    expect(result.text).toBe('ok');
    expect(result.attempts).toBe(3);
  });

  it('stops after 3 attempts', async () => {
    const scripted = new ScriptedModel(() => ({ error: apiError(500) }));
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      sleep: noSleep,
    });
    expect(result.finish).toBe('error');
    expect(result.attempts).toBe(3);
    expect(result.error?.status).toBe(500);
  });

  it('does not retry a client error, and detects an overflow', async () => {
    const scripted = new ScriptedModel([
      { error: apiError(400, '{"error":{"message":"prompt is too long: 210000 tokens"}}') },
    ]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      sleep: noSleep,
    });
    expect(result.attempts).toBe(1);
    expect(result.error?.overflow).toBe(true);
  });

  it('ends the turn with the error once text has streamed, and runs no calls', async () => {
    const scripted = new ScriptedModel([{ text: 'partial', streamError: apiError(500) }]);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      sleep: noSleep,
    });
    expect(result.text).toBe('partial');
    expect(result.finish).toBe('error');
    expect(result.attempts).toBe(1);
  });

  it('ends as aborted when the signal fires', async () => {
    const scripted = new ScriptedModel([{ text: 'slow', delayMs: 5000 }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const result = await streamTurn({
      chat: scripted.chat(),
      system: '',
      messages: [{ role: 'user', content: 'x' }],
      signal: controller.signal,
    });
    expect(result.finish).toBe('aborted');
  });
});

describe('backoffMs', () => {
  it('honours Retry-After and grows exponentially with jitter otherwise', () => {
    expect(backoffMs(1, DEFAULT_RETRY, apiError(429, '', { 'retry-after': '2' }))).toBe(2000);
    expect(backoffMs(1, DEFAULT_RETRY, apiError(429, '', { 'Retry-After': '120' }))).toBe(30_000);
    expect(backoffMs(1, DEFAULT_RETRY, apiError(500), () => 0)).toBe(500);
    expect(backoffMs(2, DEFAULT_RETRY, apiError(500), () => 1)).toBe(2000);
  });
});

describe('the limit per local server', () => {
  it('sends one request at a time to a server with one slot', async () => {
    let inFlight = 0;
    let max = 0;
    const scripted = new ScriptedModel(() => {
      inFlight++;
      max = Math.max(max, inFlight);
      return { text: 'ok', delayMs: 30 };
    });
    const chat = scripted.chat({ kind: 'ollama', baseUrl: 'http://box:11434', maxConcurrent: 1 });
    const runs = await Promise.all(
      [1, 2, 3].map(async () => {
        const r = await streamTurn({ chat, system: '', messages: [{ role: 'user', content: 'x' }] });
        inFlight--;
        return r;
      }),
    );
    expect(runs.every(r => r.text === 'ok')).toBe(true);
    expect(max).toBe(1);
  });

  it('extracts function call text emitted by local models like qwen2.5-coder', () => {
    const testTools = {
      navigate: { description: 'Navigate', parameters: {} },
      click: { description: 'Click', parameters: {} },
      ask_user: { description: 'Ask', parameters: {} },
      done: { description: 'Done', parameters: {} },
    };

    // User's exact screenshot case:
    const res1 = extractToolCallsFromText('navigate({action: "goto", url: "https://www.youtube.com"})', testTools);
    expect(res1).toHaveLength(1);
    expect(res1[0].toolName).toBe('navigate');
    expect(res1[0].input).toEqual({ action: 'goto', url: 'https://www.youtube.com' });

    // Shorthand click ref
    const res2 = extractToolCallsFromText('click({ref: "e1"})', testTools);
    expect(res2).toHaveLength(1);
    expect(res2[0].toolName).toBe('click');
    expect(res2[0].input).toEqual({ target: { ref: 'e1' } });

    // In markdown code block
    const res3 = extractToolCallsFromText('```javascript\nnavigate({url: "https://youtube.com"})\n```', testTools);
    expect(res3).toHaveLength(1);
    expect(res3[0].toolName).toBe('navigate');
    expect(res3[0].input).toEqual({ url: 'https://youtube.com' });

    // String URL navigate
    const res4 = extractToolCallsFromText('navigate("https://www.youtube.com")', testTools);
    expect(res4).toHaveLength(1);
    expect(res4[0].toolName).toBe('navigate');
    expect(res4[0].input).toEqual({ url: 'https://www.youtube.com' });

    // Bare snapshot as emitted by qwen2.5-coder in latest screenshot
    const res5 = extractToolCallsFromText('snapshot', { ...testTools, snapshot: { description: 'snap', parameters: {} } });
    expect(res5).toHaveLength(1);
    expect(res5[0].toolName).toBe('snapshot');
    expect(res5[0].input).toEqual({});

    // Bare snapshot with backticks
    const res6 = extractToolCallsFromText('`snapshot`', { ...testTools, snapshot: { description: 'snap', parameters: {} } });
    expect(res6).toHaveLength(1);
    expect(res6[0].toolName).toBe('snapshot');

    // Shorthand click [e12]
    const res7 = extractToolCallsFromText('click [e12]', testTools);
    expect(res7).toHaveLength(1);
    expect(res7[0].toolName).toBe('click');
    expect(res7[0].input).toEqual({ target: { ref: 'e12' } });

    // Pattern from qwen2.5-vl with browser-state quotes and repetitive unicode junk
    const res8 = extractToolCallsFromText(
      'open youtube and play a best song Extracted task from user message. time: 2026-10-30 13:54 · mode: navigate active tab: [201789907] «https://www.youtube.com/?hl=en&gl=US&q=%E3%80%B5%E3%80%A4%E3%80%B6%E3%80%A9%E3%80%B6%E3%80%A9%E3%80%B2%E3%80%A9»',
      testTools,
    );
    expect(res8).toHaveLength(1);
    expect(res8[0].toolName).toBe('navigate');
    expect(res8[0].input).toEqual({ url: 'https://www.youtube.com/' });

    // Natural open URL
    const res9 = extractToolCallsFromText('open https://www.youtube.com', testTools);
    expect(res9).toHaveLength(1);
    expect(res9[0].toolName).toBe('navigate');
    expect(res9[0].input).toEqual({ url: 'https://www.youtube.com' });

    // Navigate to URL
    const res10 = extractToolCallsFromText('navigate to https://www.youtube.com', testTools);
    expect(res10).toHaveLength(1);
    expect(res10[0].toolName).toBe('navigate');
    expect(res10[0].input).toEqual({ url: 'https://www.youtube.com' });

    // Thoughts stripped before tool call
    const res11 = extractToolCallsFromText(
      '<think>I will navigate now.</think> navigate({ url: "https://www.youtube.com" })',
      testTools,
    );
    expect(res11).toHaveLength(1);
    expect(res11[0].toolName).toBe('navigate');
    expect(res11[0].input).toEqual({ url: 'https://www.youtube.com' });
  });
});
