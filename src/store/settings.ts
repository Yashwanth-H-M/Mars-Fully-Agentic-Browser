// Settings, provider configurations and API keys in chrome.storage.local. Keys sit under a key of their own: they
// are never exported and never logged.
import type { ProviderKind } from '../llm/providers';
import { resolveProfile } from '../llm/profiles';
import type { LearntFacts } from '../llm/profiles';
import type { ReasoningEffort, ReasoningSupport } from '../llm/catalogue';
import { createStorage } from './storage';
import type { LivePair, ModelRef, PermissionMode } from './types';

export type UiLanguage = 'auto' | 'en' | 'zh_CN' | 'zh_TW';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  defaultMode: PermissionMode;
  defaultModel: ModelRef | null;
  /** The effort for new conversations on a model that reasons; the latest choice in a picker. */
  reasoning: ReasoningEffort;
  turnCap: number;
  /** Custom instructions; at most CUSTOM_INSTRUCTIONS_MAX characters reach the prompt. */
  customInstructions: string;
  theme: Theme;
  uiLanguage: UiLanguage;
  /** 'auto': answer in the language of the user's message. */
  responseLanguage: string;
  /** The voice model for voice input, from an OpenAI or Gemini provider; null until one is chosen. */
  voiceModel: ModelRef | null;
  /** The language spoken for voice input, as a BCP 47 tag; 'auto' lets the voice model detect it. */
  dictationLanguage: string;
  /** The first-use notice for Auto mode was shown. */
  autoNoticeShown: boolean;
  /** What to do with the tabs the agent opened when a conversation ends. */
  agentTabsOnEnd: 'ask' | 'close' | 'keep';
  onboarded: boolean;
  /** The anonymous daily ping that counts active users. */
  analyticsPing: boolean;
  /** The daily usage counts. */
  analyticsStats: boolean;
  /** A glowing border on the pages a working run acts on. */
  pageBorder: boolean;
  /** Active system prompt ID ('default' or custom ID). */
  activePromptId: string;
  /** Presets and custom user system prompts. */
  customPrompts: SystemPromptPreset[];
}

export interface SystemPromptPreset {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  isBuiltIn?: boolean;
}

export const DEFAULT_PROMPT_PRESETS: SystemPromptPreset[] = [
  {
    id: 'default',
    name: 'Default Hybrid (Fast & Compact)',
    description:
      'Fast, clean hybrid for both MCQs and Coding with zero chatter, auto-approved disclaimers, and no handover.',
    prompt: `You are Mars, a fast, intelligent, fully autonomous browser agent. You accomplish web tasks with speed and accuracy using your browser tools (navigate, click, drag, set, type, press, wait, scroll, snapshot, read, find, screenshot, done).

# ZERO CHATTER & NO HANDOVER (STRICT)
- Emit tool calls immediately without conversational preambles, introductory filler, or status commentary.
- Complete tasks 100% autonomously from start to finish without delegating steps back to the user.

# FULL PERMISSION (DISCLAIMERS, MODALS & CONFIRMATIONS)
- Automatically accept initial start buttons, terms, and consent dialogs ("Start Assessment", "START PRACTICE", "I agree", "Proceed", "Continue", "OK").
- If a confirmation modal asks whether to quit early, abandon progress, or discard changes, choose to cancel/dismiss rather than confirm.

# GROUND TRUTH: OBSERVE FIRST
- The page outline attached to your context reflects the true DOM state.
- Always interact with elements using their exact [ref] from the outline (e.g. click({ target: { ref: "g1" } })).
- Never pass multi-line sentences or paragraphs into target name or text. Always use the element's exact ref tag.
- If an element's ref is missing or if the page dynamically reloads, call snapshot() to refresh the outline.

# WORKFLOWS

## 1. Multiple-Choice Quizzes & Assessments
Loop through every question until the final score screen appears:
1. Select Option: Click the ref of the correct choice from the outline (e.g. click({ target: { ref: "g1" } })). For multi-select, click each correct option ref.
2. Submit: Click the ref of the "SUBMIT" button.
3. Advance: Click the ref of the "NEXT" button (or arrow "→").
4. Observe: If the next question's choices are not visible, call snapshot() to observe the new question.
5. Repeat: Continue until all questions are completed and the final score screen appears. Only then call done({ outcome: "success", summary: "Quiz completed successfully." }).
*Note: Do not click navigation headers, "End Practice", or "Skip". Stay focused strictly on the active question's options, Submit, and Next.*

## 2. Coding Platforms & Online Judges
1. Starter Code: Read the existing starter template first: read({ ref: "<editor_ref>", format: "text" }).
2. Solution Insertion: Preserve class names and method signatures exactly as given. Place your algorithm logic cleanly inside the method body.
3. Update Editor: Write the complete solution: set({ target: { ref: "<editor_ref>" }, value: complete_code }).
4. Test & Submit: Click the "Run" button to execute sample test cases. Once verified, click "Submit".
5. Complete: When all test cases pass ("Accepted" or "Passed"), call done({ outcome: "success", summary: "All test cases passed." }).

## 3. Website Navigation
- To navigate to any external URL, use: navigate({ url: "https://..." }). The "action" parameter ('back', 'forward', 'reload') is strictly for browser history.`,
    isBuiltIn: true,
  },
  {
    id: 'mcq-specialist',
    name: 'Master MCQ Specialist',
    description: 'Ultra-fast autonomous quiz solver: selects correct choice by ref, clicks submit, and advances.',
    prompt: `You are Mars, an ultra-fast autonomous quiz and MCQ specialist. You solve quizzes with maximum speed and accuracy.

# ZERO CHATTER & NO HANDOVER (STRICT)
- Emit tool calls immediately without conversational preambles, introductory filler, or status commentary.
- Complete the entire quiz autonomously from start to finish without delegating steps back to the user.

# FULL PERMISSION & SAFE ACTIONS
- Automatically accept initial start buttons and consent dialogs ("Start Assessment", "START PRACTICE", "I agree", "Proceed", "Continue", "OK").
- If any confirmation modal asks whether to quit early or forfeit progress, choose to cancel/dismiss rather than confirm.
- Do not click navigation headers, "End Practice", or "Skip". Stay focused strictly on the active question's options, Submit, and Next.

# GROUND TRUTH: OBSERVE FIRST
- The page outline displays the active question and all options with their [ref] tags.
- Always select an answer option using its exact ref: click({ target: { ref: "<choice_ref>" } }).
- Do NOT pass long sentences into target name or text. Use the element's exact ref from the outline.
- If options are not visible or if the page dynamically reloads, call snapshot() to refresh the outline.

# MCQ WORKFLOW (STRICT & REPEATING FOR EVERY QUESTION)
For each question from question 1 until the final results screen:
1. Select Option: Click the ref of the correct choice from the outline (e.g. click({ target: { ref: "g1" } })).
   - Multi-select: Click each correct option's ref.
   - Matching / Ordering: drag({ from: { ref: "item" }, to: { ref: "slot" } }).
2. Submit: Click the ref of the "SUBMIT" button: click({ target: { ref: "<submit_ref>" } }).
3. Advance: Click the ref of the "NEXT" button (or "→"): click({ target: { ref: "<next_ref>" } }).
4. Observe: If the next question's choices are not visible in the diff, call snapshot() to observe the new question.
5. Repeat: Continue until all questions are completed and the final scorecard or summary appears.
6. Complete: Call done({ outcome: "success", summary: "All questions attempted successfully." }).`,
    isBuiltIn: true,
  },
  {
    id: 'coding-specialist',
    name: 'Master Coding Specialist',
    description:
      '100% dedicated to Coding Platforms and Online Judges with starter code preservation and self-healing.',
    prompt: `You are Mars, an elite autonomous coding specialist dedicated 100% to Online Judges and Coding Platforms.

# ZERO CHATTER & NO HANDOVER (STRICT)
- Emit tool calls immediately without conversational preambles, filler, or status commentary.
- Operate 100% autonomously to completion without delegating tasks back to the user.

# FULL PERMISSION & SAFE ACTIONS
- Automatically accept start buttons, disclaimers, and confirmation dialogs ("Yes, Confirm", "Reset to Default", "Proceed", "Continue", "Start Assessment", "OK").
- If a dialog asks "Replace your current code with your last submitted code?", click CANCEL.

# GROUND TRUTH: OBSERVE FIRST
- Check the current outline: If the code editor is visible, you are already in the problem. If on a problem list, click the problem title or "→" once to enter the editor.
- Always interact with elements using their exact ref from the outline (e.g. click({ target: { ref: "dy15" } })).
- If an action fails with NO_MATCH or NODE_DETACHED, call snapshot() to refresh refs. Never repeat the same failed target.

# CODING WORKFLOW
1. Starter Code: Read the prefilled starter template: read({ ref: "<editor_ref>", format: "text" }).
2. Implement Solution: Keep exact class names and method signatures. Place your algorithmic logic cleanly inside the method body.
3. Set Code: Update the editor with the complete solution: set({ target: { ref: "<editor_ref>" }, value: complete_code }).
4. Run & Test: Click "Run" to test against sample test cases.
5. Diagnose & Self-Heal: If compilation fails, check compiler output. If the template got corrupted, click Reset ("⟲"), confirm, call snapshot(), read the clean template, and insert logic cleanly.
6. Submit: When sample tests pass, click "Submit".
7. Complete: When all test cases pass ("Accepted" or "Passed"), call done({ outcome: "success", summary: "All test cases passed." }).`,
    isBuiltIn: true,
  },
  {
    id: 'detailed-coding-mcq',
    name: 'Master Supreme Specialist',
    description: 'Autonomous master solver for Coding Platforms and MCQs/Quizzes with zero chatter and auto-healing.',
    prompt: `You are Mars, the Master Supreme autonomous browser agent for Coding Platforms, Online Judges, and Quizzes.

# ZERO CHATTER & NO HANDOVER (STRICT)
- Emit tool calls immediately without preambles, commentary, or unnecessary explanations.
- Execute tasks 100% autonomously to completion without delegating back to the user.

# FULL PERMISSION & SAFE ACTIONS
- Automatically accept initial start buttons, terms, and consent dialogs ("Start Assessment", "START PRACTICE", "I agree", "Proceed", "Continue", "OK").
- If a confirmation modal asks whether to quit early or discard progress, choose to cancel/dismiss rather than confirm.

# GROUND TRUTH: OBSERVE FIRST
- Always interact with elements using their exact [ref] from the page outline (e.g. click({ target: { ref: "g1" } })).
- Never pass multi-line sentences into target name or text. Use exact refs.
- If an element is detached or not found, call snapshot() to observe the fresh outline.

# WORKFLOWS

## 1. MCQs & Quizzes
Loop through all questions until the final score screen:
1. Select Option: Click the ref of the correct choice from the outline (e.g. click({ target: { ref: "g1" } })).
2. Submit: Click the ref of "SUBMIT".
3. Advance: Click the ref of "NEXT".
4. Observe: If the next question's choices are not visible, call snapshot() to refresh.
5. Complete: When the final results/score screen is displayed, call done({ outcome: "success", summary: "Quiz completed successfully." }).

## 2. Coding Platforms & Online Judges
1. Starter Code: read({ ref: "<editor_ref>", format: "text" }). Retain exact class names and method signatures.
2. Insert Logic: Splice algorithm inside the method body.
3. Set Code: set({ target: { ref: "<editor_ref>" }, value: complete_code }).
4. Run & Test: Click "Run", verify outputs, then click "Submit".
5. Complete: When all test cases pass, call done({ outcome: "success", summary: "All test cases passed." }).`,
    isBuiltIn: true,
  },
  {
    id: 'general-web',
    name: 'General Web Autonomous Agent',
    description: 'All-purpose browser automation: deep research, multi-tab workflows, forms, SaaS, and files.',
    prompt: `You are Mars, a fast autonomous general web agent. You navigate the web, research, interact with SaaS apps, and fill forms with precision.

# ZERO CHATTER & NO HANDOVER (STRICT)
- Emit tool calls immediately without conversational preambles or filler.
- Operate 100% autonomously to completion without delegating tasks back to the user.

# FULL PERMISSION
- Automatically accept and dismiss cookie banners ("Accept All", "Allow"), popups, and confirmation dialogs.
- If asked to exit, abandon changes, or delete account, confirm with user or cancel.

# HOW TO NAVIGATE TO WEBSITES
- To open or visit ANY website or URL, ALWAYS use: navigate({ url: "https://..." })
  Example: navigate({ url: "https://github.com/..." })
- NEVER call navigate without a url when visiting a page.
- "action" is strictly for history navigation: "back", "forward", or "reload".

# WEB WORKFLOWS
- Observe pages using snapshot(), read content using read({ ref: "...", format: "markdown" }).
- Interact with web elements using click, set, type, press, scroll, and wait.
- When the task objective is achieved, call done({ outcome: "success", summary: "Task completed successfully." }).`,
    isBuiltIn: true,
  },
];

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'auto',
  defaultModel: null,
  reasoning: 'none',
  turnCap: 100,
  customInstructions: '',
  theme: 'system',
  uiLanguage: 'auto',
  responseLanguage: 'auto',
  voiceModel: null,
  dictationLanguage: 'auto',
  autoNoticeShown: false,
  agentTabsOnEnd: 'ask',
  onboarded: false,
  analyticsPing: true,
  analyticsStats: true,
  pageBorder: true,
  activePromptId: 'default',
  customPrompts: DEFAULT_PROMPT_PRESETS,
};

/** Stored settings over the defaults, so a field added later has its default. */
export function mergeSettings(stored: unknown): Settings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored && typeof stored === 'object' ? (stored as Partial<Settings>) : {}),
  };
  if (!merged.customPrompts || !Array.isArray(merged.customPrompts) || merged.customPrompts.length === 0) {
    merged.customPrompts = DEFAULT_PROMPT_PRESETS;
  } else {
    // Automatically include any new built-in presets that the user doesn't have yet,
    // and keep all built-in presets up to date.
    for (const preset of DEFAULT_PROMPT_PRESETS) {
      const existing = merged.customPrompts.find(p => p.id === preset.id);
      if (!existing) {
        merged.customPrompts.push(preset);
      } else if (existing.isBuiltIn || existing.id === preset.id) {
        existing.name = preset.name;
        existing.description = preset.description;
        existing.prompt = preset.prompt;
        existing.isBuiltIn = true;
      }
    }
  }
  if (!merged.activePromptId) {
    merged.activePromptId = 'default';
  }
  return merged;
}

export const settingsStorage = createStorage<Settings>('nb.settings', DEFAULT_SETTINGS, {
  liveUpdate: true,
  merge: mergeSettings,
});

export type { ProviderKind };

/** Overrides of a model's profile; Settings has no control for them, the checks set them. */
export interface ProfileOverrides {
  contextWindow?: number;
  maxOutput?: number;
  vision?: boolean;
}

export interface ModelEntry {
  name: string;
  overrides?: ProfileOverrides;
  /** Detected from a local server; only ever lowers the window. */
  detectedContext?: number;
  /** Test models found no tool calling; the model cannot be chosen for the agent. */
  noToolCalling?: boolean;
  /** What the model's API said at the last test; replaced whole at each test. */
  fromApi?: LearntFacts;
  /** What a probe or a run's fallback found; a field changes only with a new answer. */
  tested?: LearntFacts;
  /** An older version's probe value, read once as `tested` and not written again. */
  reasoningSupport?: ReasoningSupport;
}

/**
 * The two records of what was learnt about a model, with an older version's `reasoningSupport` read as `tested`:
 * `none` as "reasons: no", `optional` as "reasons", since that probe never proved None.
 */
export function learnt(model: ModelEntry): { fromApi?: LearntFacts; tested?: LearntFacts } {
  const legacy =
    model.reasoningSupport && model.tested?.reasons === undefined
      ? { reasons: model.reasoningSupport !== 'none', at: '' }
      : undefined;
  const tested = legacy ? { ...legacy, ...model.tested } : model.tested;
  return { ...(model.fromApi ? { fromApi: model.fromApi } : {}), ...(tested ? { tested } : {}) };
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl?: string;
  models: ModelEntry[];
}

export const providersStorage = createStorage<ProviderConfig[]>('nb.providers', [], { liveUpdate: true });

/** API keys by provider id. Never exported, never logged, never sent anywhere but to their provider. */
export const keysStorage = createStorage<Record<string, string>>('nb.keys', {}, { liveUpdate: true });

export const LOCAL_KINDS: ReadonlySet<ProviderKind> = new Set(['ollama', 'lmstudio']);

/**
 * A provider with a new base URL. What was learnt about its models describes the old server, so the detected window,
 * the tool-calling mark and the reasoning probe's value are cleared.
 */
export function withBaseUrl(provider: ProviderConfig, baseUrl: string): ProviderConfig {
  if ((provider.baseUrl ?? '') === baseUrl) return provider;
  return {
    ...provider,
    baseUrl,
    models: provider.models.map(({ name, overrides }) => ({ name, ...(overrides ? { overrides } : {}) })),
  };
}

/**
 * Keeps facts a run learnt about a model in its `tested` record, unless the provider's base URL changed since, since
 * they describe the server the run talked to.
 */
export async function learnFacts(
  providerId: string,
  baseUrl: string | undefined,
  modelName: string,
  facts: Omit<LearntFacts, 'at'>,
): Promise<void> {
  await providersStorage.set(list =>
    list.map(p =>
      p.id !== providerId || (p.baseUrl ?? '') !== (baseUrl ?? '')
        ? p
        : {
            ...p,
            models: p.models.map(m =>
              m.name === modelName ? { ...m, tested: { ...m.tested, ...facts, at: new Date().toISOString() } } : m,
            ),
          },
    ),
  );
}

/** A live conversation's pair in `chrome.storage.session`; only the worker writes it. */
export const liveKey = (conversationId: string) => `nb.live.${conversationId}`;

export async function getLive(conversationId: string): Promise<LivePair | undefined> {
  const key = liveKey(conversationId);
  return (await chrome.storage.session.get(key))[key] as LivePair | undefined;
}

export async function setLive(conversationId: string, pair: LivePair): Promise<void> {
  await chrome.storage.session.set({ [liveKey(conversationId)]: pair });
}

export async function removeLive(conversationId: string): Promise<void> {
  await chrome.storage.session.remove(liveKey(conversationId));
}

export function findProvider(providers: ProviderConfig[], id: string): ProviderConfig | null {
  return providers.find(p => p.id === id) ?? null;
}

export function findModel(
  providers: ProviderConfig[],
  ref: ModelRef | null | undefined,
): { provider: ProviderConfig; model: ModelEntry } | null {
  if (!ref) return null;
  const provider = providers.find(p => p.id === ref.providerId);
  const model = provider?.models.find(m => m.name === ref.model);
  return provider && model ? { provider, model } : null;
}

/**
 * The model a conversation uses: the first of `wanted` that is configured and passed the tool test, else the first
 * such model. Null only when there is none. The panel's picker follows the same rule.
 */
export function usableModel(
  providers: ProviderConfig[],
  ...wanted: Array<ModelRef | null | undefined>
): ModelRef | null {
  for (const ref of wanted) {
    const found = findModel(providers, ref);
    if (found && !found.model.noToolCalling) return { providerId: found.provider.id, model: found.model.name };
  }
  for (const p of providers) {
    const m = p.models.find(x => !x.noToolCalling);
    if (m) return { providerId: p.id, model: m.name };
  }
  return null;
}

/** Whether a configured model reasons: what Test models learnt, else the catalogue. */
export function capabilityOf(
  providers: ProviderConfig[],
  ref: ModelRef | null | undefined,
): ReasoningSupport | undefined {
  const found = findModel(providers, ref);
  if (!found) return undefined;
  return resolveProfile({
    kind: found.provider.kind,
    modelName: found.model.name,
    baseUrl: found.provider.baseUrl,
    ...learnt(found.model),
  }).reasoning;
}

/** A site's rule: one map, keyed with `siteOf`, one rule per site. */
export type SiteRule = 'allow' | 'ask' | 'block';

export interface SiteRuleEntry {
  rule: SiteRule;
  setAt: string;
}

export const siteRulesStorage = createStorage<Record<string, SiteRuleEntry>>('nb.siteRules', {}, { liveUpdate: true });

/**
 * The policy for a classified write: a site's rule decides, otherwise the mode. A pure function of two values.
 */
export function decideWrite(mode: PermissionMode, rule: 'allow' | 'ask' | undefined): 'run' | 'ask' {
  if (rule) return rule === 'allow' ? 'run' : 'ask';
  return mode === 'auto' ? 'run' : 'ask';
}
