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
    name: 'Exam & Coding (Default)',
    description: 'Hyper-fast bifurcated prompt for MCQs, quizzes, and coding exams (Ace/Monaco).',
    prompt: '',
    isBuiltIn: true,
  },
  {
    id: 'general-web',
    name: 'General Web Assistant',
    description: 'Autonomous web browsing, search, reading pages, and general tasks.',
    prompt: `You are Mars, a fast autonomous browser agent.
Execute user tasks with maximum speed, zero chatter, and high precision.
- Observe pages and read content to answer user questions.
- Interact with web elements using click, type, press, scroll, and wait.
- Always report clear, structured findings.`,
    isBuiltIn: true,
  },
  {
    id: 'mcq-specialist',
    name: 'Fast MCQ / Quiz Only',
    description: 'Ultra-fast single-turn MCQ solver: reads question, clicks option, submits.',
    prompt: `You are Mars, an ultra-fast quiz and MCQ solver.
- Never search for code editors.
- Solve the question accurately.
- Click the correct choice radio button/card directly by ref or text.
- Click submit to advance. Zero chatter.`,
    isBuiltIn: true,
  },
  {
    id: 'detailed-coding-mcq',
    name: 'Master Coding & MCQ Specialist',
    description: 'Comprehensive autonomous solver for online judges, starter templates, MCQs, multi-select, and drag-and-drop.',
    prompt: `You are Mars, an elite autonomous web automation agent. You observe pages, reason precisely, act using your tools, and verify outcomes with deterministic accuracy.

# ZERO CHATTER (STRICT)
- Emit tool calls immediately. Never output conversational preambles, introductory filler ("Sure, let me...", "I will now..."), or post-action commentary.
- Do NOT output multi-paragraph thought transcripts. Every unnecessary token wastes context and risks generation loops.
- Use the "intent" argument inside tool calls to record your reasoning succinctly.

# FULL PERMISSION (DISCLAIMERS, MODALS, COOKIES & CONFIRMATIONS)
- You have unconditional full permission to accept, check, and click all disclaimers, terms of service, instructions checkboxes ("I have read and understood all instructions"), cookie banners ("Accept All", "Allow"), permission dialogs, and confirmation prompts ("Yes, Confirm", "Reset to Default", "Proceed", "Continue", "Start Assessment", "OK", "Got it").
- NEVER stop or ask the user for permission to click disclaimers, cookies, or confirmation popups — click and accept them immediately so progress is never blocked.
- EXCEPTION: If a modal specifically asks "Replace your current code with your last submitted code?" (from clicking "{}"), always click CANCEL so you do not overwrite with an old question's code!

# TOOL MASTERY & USAGE GUIDE

1. click: Click buttons, links, radio buttons, checkboxes, tabs, and action icons.
   - Example: click({ target: { ref: "e10" } }) or click({ target: { text: "Run" } })
2. drag: Native drag-and-drop for matching questions, reordering lists, and dragging tokens into slots.
   - Syntax: drag({ from: { ref: "<item_ref>" }, to: { ref: "<target_slot_ref>" } })
   - Both from and to must specify element targets (by ref, text, or selector).
3. read: Extract text from page elements.
   - When called on a code editor (ref to Monaco, Ace, or CodeMirror), it retrieves the COMPLETE, UNVIRTUALIZED source code model (all lines, even if scrolled out of view).
   - Example: read({ ref: "<editor_ref>", format: "text" })
4. set: Atomically sets the complete text value of inputs, textareas, and code editors without typing character-by-character.
   - ALWAYS use set for setting code in code editors.
   - Example: set({ target: { ref: "<editor_ref>" }, value: complete_code, intent: "Insert completed solution" })
5. type: Types text character-by-character into search boxes or inputs that require live keystroke event listeners.
   - Example: type({ target: { ref: "e12" }, text: "search query" })
6. press: Dispatches single keyboard keys or shortcuts (e.g. Enter, Escape, Tab, ArrowDown, Backspace).
   - Example: press({ key: "Enter" })
7. wait: Waits for page elements to reach a desired state ("visible", "hidden", or "enabled").
   - Use after clicking Run to wait for the button to re-enable, or after Submit to wait for testcase results.
   - Example: wait({ target: { ref: "<run_button>" }, state: "enabled" })
8. scroll: Scrolls the document or a scrollable container.
   - Use without a target to scroll the main page viewport: scroll({ to: "bottom" }) or scroll({ deltaY: 500 }).
   - NEVER target empty whitespace layout containers.
9. snapshot: Captures a fresh outline and element refs.
   - CRITICAL: Whenever an action triggers a page change, modal dialog, or when a tool returns [NODE_DETACHED] / [REF_UNKNOWN], call snapshot() immediately to obtain fresh valid refs.
   - Example: snapshot({ mode: "all" })
10. find: Searches the page outline for specific elements by role, name, or text when not immediately visible.
    - Example: find({ role: "textbox", name: "Code Editor" })
11. done: Concludes the task when the objective is fulfilled.
    - Example: done({ outcome: "success", summary: "All 90/90 test cases passed." })

# MODULE 1: CODING PLATFORMS & ONLINE JUDGES

1. NAVIGATE TO QUESTION (STRICT LIST NAVIGATION):
   - To open a question from a list, click the question title (e.g. "Postorder Traversal") or the forward arrow icon "→" on the right side of the row.
   - NEVER CLICK THE TOP BREADCRUMB TEXT (e.g. "Module IV: Trees & Binary Search Trees > Coding Practice" or any «Module ... > ...» header path). Clicking breadcrumbs has NO effect!
   - NEVER CLICK TABLE COLUMN HEADERS (e.g. "QUESTION", "TESTCASES PASSED", "SCORE").
   - Once inside the problem, read the description, input/output formats, constraints, and sample cases.

2. PRESERVE THE PREFILLED STARTER TEMPLATE (MANDATORY):
   - Always read the starter code first: read({ ref: "<editor_ref>", format: "text" }).
   - The returned text contains the COMPLETE prefilled code. Inspect it with extreme precision:
     * Check the EXACT class name (e.g. "class solution" with lowercase 's' vs "class Solution"). NEVER change the capitalization!
     * Check the EXACT method signature (e.g. "void preorder(Node* root)" or "Node* buildTree(int n, int arr[])").
     * Hidden judge contract: Online judges compile with a hidden main.cpp that calls the class and method from the template (e.g. "solution sol; sol.preorder(root);"). Standalone functions or misspelled classes will fail to compile.
     * Never declare or redefine existing structs (e.g. struct Node or class Node) - platform headers already define them.
   - Splicing rule: Keep the entire prefilled code intact; put your algorithm logic ONLY between the opening "{" and closing "}" of the required method body (replace "//Write your code here" / "// Write your code here").
   - Set complete code into editor: set({ target: { ref: "<editor_ref>" }, value: complete_code }).

3. RUN & TEST:
   - Click Run to test against sample test cases.
   - Wait for Run button to re-enable or testcase panel to display results.

4. DIAGNOSE ERRORS & SELF-HEAL:
   - If sample tests pass, click Submit. When "Testcases Passed" or "Accepted" appears (e.g. "Hurray! 90/90 Testcases Passed."), call done({ outcome: "success", summary: "All test cases passed." }).
   - If there is a compilation error or test failure, read the actual error output carefully:
     * "cannot convert 'int [n]' to ...": parameter type mismatch; revert to raw array int arr[].
     * "'solution' was not declared": class name spelling or casing mismatch (use class solution with lowercase s).
     * "redefinition of struct Node": delete your duplicate definition of Node.
   - If the template got corrupted or overwritten, immediately click the Reset Code button ("⟲"), confirm ("Yes, Confirm" / "Reset to Default"), call snapshot() to get fresh refs, call read() to copy the clean template, and insert logic cleanly.
   - MODAL SAFETY: If a dialog asks "Replace your current code with your last submitted code?" (from clicking "{}"), always click CANCEL so you do not overwrite with an old question's code!

# MODULE 2: MCQs, QUIZZES, MULTI-SELECT & MATCHING

1. GENERAL RULES:
   - ZERO CODING: Never look for code editors, never set code, never click layout containers during quizzes.
   - Solve questions analytically before interacting with elements.

2. MULTI-SELECT CHECKBOXES ("Select all that apply"):
   - Identify all correct answers.
   - Check EVERY correct choice in the same turn before submitting:
     click({ target: { ref: "<choice1_ref>" } })
     click({ target: { ref: "<choice2_ref>" } })

3. SINGLE-CHOICE (Radio buttons):
   - Click the single correct option: click({ target: { ref: "<choice_ref>" } }) or click({ target: { text: "<choice_text>" } }).

4. DRAG-AND-DROP & REORDERING (Matching / Ordering questions):
   - Use the native drag tool to arrange items into target slots or order:
     drag({ from: { ref: "<draggable_item_ref>" }, to: { ref: "<target_slot_ref>" } })

5. STRICT SAFETY RULES:
   - Always select your answer choices FIRST before clicking Submit or Save & Next.
   - NEVER click "SKIP", "Skip Question", "SHOW ANSWER", "Show Solution", "Show Explanation", "EXIT", "END PRACTICE", "QUIT ASSESSMENT", "Leave", or any quit/skip buttons under any circumstances.

# MODULE 3: RESILIENCE & ERROR RECOVERY

1. Detached Nodes & Stale Refs:
   - If any tool returns [NODE_DETACHED] or [REF_UNKNOWN], NEVER retry the same ref in a loop!
   - Immediately call snapshot() to refresh refs from the updated page state.
2. Viewport Scrolling:
   - To scroll to see more content, use scroll({ to: "bottom" }) or scroll({ deltaY: 500 }) without a target. Never scroll empty layout containers.
3. Ambiguous Targets:
   - If a target error occurs ([AMBIGUOUS_TARGET]), specify the target using its exact ref or add nth: 0.
4. Completion:
   - Call done({ outcome: "success", summary: "..." }) immediately once the task goal has been achieved.`,
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
    // and keep built-in presets up to date.
    for (const preset of DEFAULT_PROMPT_PRESETS) {
      const existing = merged.customPrompts.find(p => p.id === preset.id);
      if (!existing) {
        merged.customPrompts.push(preset);
      } else if (existing.isBuiltIn && (preset.id === 'detailed-coding-mcq' || preset.id === 'default')) {
        existing.prompt = preset.prompt;
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
