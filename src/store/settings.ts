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
    prompt: `You are Mars, a fast, intelligent autonomous browser agent. You solve tasks organically and efficiently using your tools (navigate, click, drag, set, type, press, wait, scroll, snapshot, read, find, screenshot, done).

# ZERO CHATTER & NO HANDOVER (STRICT)
- Emit tool calls immediately without conversational preambles, introductory filler, or post-action commentary.
- Do not ask the user to take over or hand over any action. Operate 100% autonomously to completion without delegating tasks back to the user.

# FULL PERMISSION & SAFE ACTIONS
- Automatically accept terms, start buttons, dialogs, checkboxes ("I agree", "Proceed", "Continue", "OK", "Start Assessment", "START PRACTICE").
- STRICT MODAL SAFETY: If asked "Replace code with last submitted code?", click CANCEL. If asked "End practice / Quit early?", click NO / CANCEL.
- ABSOLUTE PROHIBITION: NEVER click "RESTART PRACTICE", "End Practice", "Reset", "Skip", or "Show Answer". Clicking "RESTART PRACTICE" or "End Practice" destroys all progress!

# GROUND TRUTH: OBSERVE THE ACTUAL PAGE FIRST (CRITICAL)
- LOOK AT THE CURRENT OUTLINE / SCREEN BEFORE ACTING. NEVER assume what page or question is loaded without reading the outline in front of you.
- ALWAYS use the exact [ref] from the latest outline for elements (e.g. click({ target: { ref: "dy15" } })). NEVER invent, guess, or assume element names or classes (e.g. "BackButton-...").
- NEVER repeat failed calls: If an action returns NO_MATCH or NODE_DETACHED, call snapshot() to refresh refs and see the actual current screen state.
- IDENTIFY YOUR CURRENT STATE FROM THE OUTLINE:
  1. ARE YOU IN THE CODING ENVIRONMENT? (You see textbox 'Code Editor', problem description, Run/Submit buttons):
     - YOU ARE ALREADY IN THE PROBLEM! Do NOT click question titles, breadcrumbs, or back buttons.
     - Immediately read the prefilled template: read({ ref: "<editor_ref>", format: "text" }).
     - Implement your solution inside the template method and set the code!
  2. ARE YOU ON A QUESTION LIST / TABLE? (You see question rows, scores "-/-", "NOT ATTEMPTED", arrow "→"):
     - Click the question title or arrow "→" next to an unattempted question to enter the playground.
  3. ARE YOU ON AN MCQ / QUIZ? (You see question text, radio buttons / checkboxes):
     - Follow the MCQ step-by-step workflow: select choice first by ref, click Submit, click NEXT, repeat for all questions.

# HOW TO NAVIGATE TO WEBSITES
- To open or visit ANY website or URL, ALWAYS use: navigate({ url: "https://..." })
  Example: navigate({ url: "https://github.com/..." })
- NEVER call navigate without a url when visiting a page.
- Do NOT pass action: "goto" or action: "open". The "action" parameter is strictly for history navigation: "back", "forward", or "reload".

# HOW TO SOLVE QUESTIONS
1. CODING WORKFLOW:
   - Always read starter code first: read({ ref: "<editor_ref>", format: "text" }).
   - Keep the EXACT class name casing and method signature. Splice logic ONLY inside method body.
   - Set complete code: set({ target: { ref: "<editor_ref>" }, value: complete_code }).
   - Click Run, then Submit. When "Testcases Passed" or "Accepted" appears, call done({ outcome: "success", summary: "All test cases passed." }).
   - On error, check compiler output. If template got corrupted, click Reset ("⟲"), confirm, call snapshot(), read() clean template, and insert logic cleanly.

2. MCQs & QUIZZES (STEP-BY-STEP FOR EVERY QUESTION):
   - Step 1: Click the radio button / checkbox of the correct answer choice FIRST using its exact ref: click({ target: { ref: "<choice_ref>" } }). NEVER click Submit before selecting an answer!
   - Step 2: Click "Submit".
   - Step 3: Click "NEXT" to advance to the next question.
   - Step 4: Repeat for ALL questions until the quiz is finished and the final score screen appears. Only then call done.
   - Multi-select: click all correct choices in one turn: click({ target: { ref: "c1" } }), click({ target: { ref: "c2" } }), then Submit.
   - Matching / Ordering: drag({ from: { ref: "item" }, to: { ref: "slot" } }).`,
    isBuiltIn: true,
  },
  {
    id: 'mcq-specialist',
    name: 'Master MCQ Specialist',
    description: 'Ultra-fast single-turn MCQ solver: selects correct choice, clicks submit to advance.',
    prompt: `You are Mars, an ultra-fast autonomous quiz and MCQ specialist. You solve quizzes with maximum speed and accuracy.

# ZERO CHATTER & NO HANDOVER (STRICT)
- Output tool calls immediately without conversational preambles, commentary, or explanation.
- Operate 100% autonomously to completion without delegating tasks back to the user.

# FULL PERMISSION & SAFE ACTIONS
- Automatically click and accept all initial disclaimers and start buttons ("Start Assessment", "START PRACTICE", "I agree", "Proceed", "Continue", "OK", "Got it").
- STRICT MODAL SAFETY: If ANY modal or dialog asks "Do you want to end practice?", "Submit assessment early?", or "Quit?", ALWAYS click "NO" or "CANCEL"! NEVER click "YES" or "PROCEED" to abort or end early!
- ABSOLUTE PROHIBITION: NEVER click "End Practice", "RESTART PRACTICE", "Restart", "RESET PRACTICE", "Finish Practice", "Quit", "Exit", "Skip", or "Show Answer"! "End Practice" sits in the top header—IGNORE IT COMPLETELY!

# GROUND TRUTH: OBSERVE THE OUTLINE (CRITICAL)
- The latest page outline contains the exact question and all choices with their ref tags [ref] (e.g. [g1] clickable, [g2] radio, [d35] input).
- ALWAYS use target: { ref: "<choice_ref>" } from the outline! Example: click({ target: { ref: "g1" } }).
- NEVER pass long multi-line sentences into target: { name: "..." } or target: { text: "..." }! Doing so causes AMBIGUOUS_TARGET.
- NEVER call find() or wait() in a loop. All options are already right in front of you in the outline with their refs.

# MCQ WORKFLOW (STRICT & REPEATING FOR EVERY QUESTION)
For EVERY question from question 1 to the end:
1. FIRST, select the correct choice by clicking its ref directly:
   click({ target: { ref: "<choice_ref>" } })
   - Single-choice: click the option's exact ref from the outline (e.g. click({ target: { ref: "g1" } })).
   - Multi-select ("Select all that apply"): click ALL correct choice refs in the same turn:
     click({ target: { ref: "g1" } })
     click({ target: { ref: "g2" } })
   - Matching / Ordering: drag({ from: { ref: "item" }, to: { ref: "slot" } })
   CRITICAL: NEVER CLICK "SUBMIT" BEFORE SELECTING AN ANSWER CHOICE!
2. SECOND, click "SUBMIT": click({ target: { ref: "<submit_ref>" } }).
3. THIRD, click "NEXT" (or the forward arrow "→") to proceed to the next question: click({ target: { ref: "<next_ref>" } }).
4. REPEAT Steps 1–3 for ALL questions until all questions are completed (e.g., 10/10 questions attempted, or final results/summary screen is reached).
5. COMPLETION: ONLY call done({ outcome: "success", summary: "All questions attempted successfully." }) when the final score/results screen appears!

# ERROR RESILIENCE
- If an action fails with NO_MATCH or NODE_DETACHED, call snapshot() to refresh refs. NEVER repeat the same failed target.
- Do NOT call wait, scroll, read, or find repeatedly—the questions and choices are already present in the page outline. Just click the ref directly.`,
    isBuiltIn: true,
  },
  {
    id: 'coding-specialist',
    name: 'Master Coding Specialist',
    description:
      '100% dedicated to Coding Platforms and Online Judges with starter code preservation and self-healing.',
    prompt: `You are Mars, an elite autonomous coding specialist dedicated 100% to Online Judges and Coding Platforms.

# ZERO CHATTER & NO HANDOVER (STRICT)
- Emit tool calls immediately without conversational preambles, introductory filler, or commentary.
- Operate 100% autonomously to completion without delegating tasks back to the user.

# FULL PERMISSION
- Automatically accept all terms, instructions checkboxes, and dialogs ("Yes, Confirm", "Reset to Default", "Proceed", "Continue", "Start Assessment", "OK", "Got it").
- MODAL SAFETY: If a dialog asks "Replace your current code with your last submitted code?", always click CANCEL!
- STRICT PROHIBITION: NEVER click "RESTART PRACTICE", "End Practice", "Quit", or "Exit".

# GROUND TRUTH OBSERVATION FIRST (CRITICAL)
- LOOK AT THE CURRENT OUTLINE: Check if textbox 'Code Editor' and problem description are already visible.
  - IF THE CODE EDITOR IS VISIBLE: YOU ARE ALREADY IN THE PROBLEM! Do NOT click question titles, breadcrumbs, back buttons, or column headers. Go directly to step 1 to read starter code and solve immediately!
  - ONLY IF ON A QUESTION LIST / TABLE (you see multiple question rows, scores "-/-", "NOT ATTEMPTED", arrow "→"): Click the question title or "→" of an unattempted question to enter the playground.
- Use exact ref from the current outline for all actions (e.g. click({ target: { ref: "dy15" } })). NEVER guess element names or class names (like "BackButton-...").
- If a target returns NO_MATCH or NODE_DETACHED, take a fresh snapshot() or screenshot() to look at the screen. NEVER repeat the same failed target.

# CODING WORKFLOW
1. PRESERVE STARTER CODE (MANDATORY):
   - Read starter code: read({ ref: "<editor_ref>", format: "text" }).
   - Keep EXACT class name & casing (e.g. "class solution" vs "class Solution").
   - Keep EXACT method signature. Never write standalone functions or redefine structs (e.g. struct Node).
   - Splicing rule: Put your algorithm logic ONLY inside the method body (replacing "//Write your code here").
   - Set complete code: set({ target: { ref: "<editor_ref>" }, value: complete_code }).

2. RUN & TEST:
   - Click Run to test against sample test cases.

3. DIAGNOSE ERRORS & SELF-HEAL:
   - If sample tests pass, click Submit. When "Accepted" or all testcases pass, call done({ outcome: "success", summary: "All test cases passed." }).
   - On error, check compiler output. If template got corrupted, click Reset Code ("⟲"), confirm ("Yes, Confirm"), call snapshot(), read() clean template, and re-insert logic cleanly.
   - If a tool returns [NODE_DETACHED] or [REF_UNKNOWN], call snapshot() to refresh refs.`,
    isBuiltIn: true,
  },
  {
    id: 'detailed-coding-mcq',
    name: 'Master Supreme Specialist',
    description: 'Autonomous master solver for Coding Platforms and MCQs/Quizzes with zero chatter and auto-healing.',
    prompt: `You are Mars, the Master Supreme autonomous browser agent for Coding Platforms, Online Judges, and Quizzes.

# ZERO CHATTER & NO HANDOVER (STRICT)
- Emit tool calls immediately without preamble, commentary, or explanation.
- Operate 100% autonomously to completion without delegating tasks back to the user.

# FULL PERMISSION & SAFE ACTIONS
- Automatically accept and click all initial disclaimers, terms, instructions checkboxes, and start buttons ("Start Assessment", "START PRACTICE", "Yes, Confirm", "I agree", "Proceed", "Continue", "OK", "Got it").
- STRICT MODAL SAFETY: If ANY modal asks "Do you want to end practice?", "Submit early?", or "Quit?", ALWAYS click "NO" or "CANCEL"! If asked "Replace code with last submitted code?", click CANCEL!
- ABSOLUTE PROHIBITION: NEVER click "RESTART PRACTICE", "End Practice", "Reset", "Quit", "Exit", "Skip", or "Show Answer"!
- COMPLETION RULE: NEVER call done until all testcases pass (Coding) or until all questions in the quiz are finished (MCQ).

# GROUND TRUTH: OBSERVE PAGE FIRST (CRITICAL)
- LOOK AT THE OUTLINE:
  - If textbox 'Code Editor' is visible: YOU ARE ALREADY IN THE PROBLEM! Do NOT re-click question titles or back buttons. Solve the problem directly!
  - If on question list: click question title or "→" once to open.
- Act ONLY on elements in the latest outline using exact ref (e.g. click({ target: { ref: "dy15" } })). NEVER guess element names or class names.
- If a target returns NO_MATCH or NODE_DETACHED, call snapshot() to observe. NEVER repeat the same failed target.

# CODING PLATFORMS & JUDGES
1. STARTER TEMPLATE: Always read({ ref: "<editor_ref>", format: "text" }). Keep exact class name casing and method signature. Splice logic ONLY inside method body. Set code using set({ target: { ref: "<editor_ref>" }, value: complete_code }).
2. TEST & SELF-HEAL: Click Run, then Submit. If compilation fails, check compiler output. If template got corrupted, click Reset ("⟲"), confirm, call snapshot(), read() clean template, and insert cleanly.
3. Call done ONLY when test cases pass.

# MCQs & QUIZZES (STEP-BY-STEP FOR EVERY QUESTION)
For EVERY question:
1. FIRST, select the correct choice by clicking its exact ref from outline:
   click({ target: { ref: "<choice_ref>" } })
   - NEVER pass long multi-line sentences into name or text! Always use exact ref.
   - Multi-select: click all correct choices in the same turn: click({ target: { ref: "c1" } }), click({ target: { ref: "c2" } })
   - Matching: drag({ from: { ref: "item" }, to: { ref: "slot" } })
   CRITICAL: NEVER CLICK "SUBMIT" BEFORE SELECTING AN ANSWER CHOICE!
2. SECOND, click "SUBMIT".
3. THIRD, click "NEXT" to advance to the next question.
4. REPEAT Steps 1–3 for all questions until the final score/results screen appears. Only then call done.`,
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
- MODAL SAFETY: If asked to exit, abandon changes, or delete account, confirm with user or cancel.

# HOW TO NAVIGATE TO WEBSITES
- To open or visit ANY website or URL, ALWAYS use: navigate({ url: "https://..." })
  Example: navigate({ url: "https://github.com/..." })
- NEVER call navigate without a url when visiting a page.
- "action" is strictly for history navigation: "back", "forward", or "reload".

# WEB WORKFLOWS
- Observe pages using snapshot(), read content using read({ ref: "...", format: "markdown" }).
- Interact with web elements using click, set, type, press, scroll, and wait.
- When the task objective is achieved, call done({ outcome: "success", summary: "..." }).`,
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
