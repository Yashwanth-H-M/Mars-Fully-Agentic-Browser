// A conversation's layer session as the extension makes it: the hand-over policy, the agent's own labels for the
// boundary, `human` for ask_user, no clock on write cards, 15 minutes for ask_user, and the host's write policy,
// blocked sites and tab placement passed in.
import type { Controller, Session, SessionConfig, TabsData } from '@src/browser-control';
import type { LayerPort } from '@src/agent/ports';
import type { PageBorder } from './border';

/** The extension's labels, defused wherever page text holds them. */
export const AGENT_LABELS = ['[Mars note', 'browser-state', 'agent-notes', 'custom-instructions'];

/** ask_user waits 15 minutes in agent sessions: a person may be in another window. */
export const ASK_TIMEOUT_MS = 15 * 60_000;

export function createAgentSession(
  controller: Controller,
  config: SessionConfig = {},
  border?: Pick<PageBorder, 'cursor'>,
): Session {
  return controller.createSession({
    capabilities: ['human', 'files'],
    // Files come from chat attachments only, never a path on the user's disk.
    uploadSources: ['attachments'],
    handover: false,
    // Match the agent's RESULT_CAP (8k chars) so the perception layer does not generate output that gets discarded.
    budget: 8_000,
    confirmTimeoutMs: Infinity,
    askTimeoutMs: ASK_TIMEOUT_MS,
    boundary: { labels: AGENT_LABELS },
    onCursor: (tabId, data) => {
      border?.cursor(tabId, data);
      config.onCursor?.(tabId, data);
    },
    ...config,
  });
}

/**
 * The tab a `screenshot` captures, found as the session finds it: a ref names its own tab, then `tabId`, then the
 * session's active tab. Null for a ref the session does not know: the call fails, and nothing needs hiding.
 */
export function screenshotTab(session: Session, args: Record<string, unknown>): number | null {
  if (typeof args.ref === 'string') return session.controller.registry.get(args.ref)?.tabId ?? null;
  if (typeof args.tabId === 'number') return args.tabId;
  return session.activeTabId;
}

/** A page dialog blocks the page: a script put into it would wait until the dialog is closed. */
function dialogOpen(session: Session, tabId: number): boolean {
  return session.hasTab(tabId) && session.controller.tabState(tabId).pending.some(m => m.kind === 'dialog');
}

/** The loop's view of a session (src/agent/ports.ts). A screenshot fades the page border out first. */
export function layerPort(session: Session, border?: Pick<PageBorder, 'around' | 'cursor'>): LayerPort {
  return {
    call: async (tool, args, signal) => {
      const activeTab = session.activeTabId;
      if (activeTab && border?.cursor) {
        if (tool === 'click') border.cursor(activeTab, { id: 'mars', action: 'click', label: 'Clicking...' });
        else if (tool === 'set' || tool === 'type' || tool === 'press')
          border.cursor(activeTab, { id: 'mars', action: 'type', label: 'Typing...' });
        else if (tool === 'scroll') border.cursor(activeTab, { id: 'mars', action: 'scroll', label: 'Scrolling...' });
        else if (tool === 'hover') border.cursor(activeTab, { id: 'mars', action: 'hover', label: 'Hovering...' });
        else if (tool === 'snapshot' || tool === 'observe')
          border.cursor(activeTab, { id: 'mars', action: 'read', label: 'Observing...' });
        else if (tool === 'wait') border.cursor(activeTab, { id: 'mars', action: 'wait', label: 'Waiting...' });
      }

      const run = () => session.call(tool, args, { signal });
      let result;
      if (tool === 'screenshot' && border) {
        const tabId = screenshotTab(session, args);
        if (tabId === null || dialogOpen(session, tabId)) result = await run();
        else result = await border.around(tabId, run);
      } else {
        result = await run();
      }

      if (activeTab && border?.cursor && result?.data && typeof result.data === 'object' && 'point' in result.data) {
        const pt = (result.data as { point?: { x: number; y: number } }).point;
        if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
          border.cursor(activeTab, { id: 'mars', x: pt.x, y: pt.y, action: tool, label: 'Mars' });
        }
      }

      return result;
    },
    async tabs() {
      const result = await session.call('tabs', { action: 'list' });
      return (result.data as TabsData | undefined) ?? { tabs: [], activeTabId: session.activeTabId };
    },
    tabInfo(tabId) {
      if (!session.hasTab(tabId)) return null;
      const state = session.controller.tabState(tabId);
      return { rev: state.rev, pending: [...state.pending] };
    },
    wrap: (text, source) => session.wrap(text, source),
  };
}
