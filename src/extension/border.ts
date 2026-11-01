// The page border: while a run works, a soft glow around each page of its conversation tells the user where the agent
// acts. The worker puts one small function into the top frame of those pages; it draws an element the layer does not
// see (on <html>, no pointer events, hidden from accessibility, its content in a closed shadow root). The border goes
// away when the run stops working, fades out for the model's screenshots, and can be turned off in Settings.
import { settingsStorage } from '@src/store/settings';
import type { RunStatus } from '@src/store/types';

export type BorderState = 'on' | 'hidden' | 'off';

export interface CursorUpdate {
  id?: string;
  x?: number;
  y?: number;
  action?: string;
  label?: string;
}

export interface BorderPorts {
  /** The conversation a tab belongs to, if any. */
  conversationOf(tabId: number): Promise<string | null>;
  /** A conversation's tabs. */
  tabsOf(conversationId: string): Promise<number[]>;
  /** Every tab that belongs to a conversation. */
  scopedTabs(): Promise<number[]>;
  /** The Settings switch. */
  enabled(): Promise<boolean>;
  /** Runs `setBorder(state)` in the tab's top frame, or in one document of it; resolves when it has. */
  inject(tabId: number, state: BorderState, documentId?: string): Promise<void>;
}

/** How long a screenshot waits for the border to fade out; past it, the capture goes ahead. */
export const HIDE_WAIT_MS = 170;

export class PageBorder {
  /** Conversations whose run is working now. */
  #running = new Set<string>();
  /** Screenshots in progress, per tab. */
  #capturing = new Map<number, number>();
  /** The fade out of a tab with screenshots in progress: they all wait for the same one. */
  #hiding = new Map<number, Promise<void>>();

  constructor(private readonly ports: BorderPorts) {}

  /** At worker start: no run is working yet, so no page keeps a border from before. */
  async start(): Promise<void> {
    for (const tabId of await this.ports.scopedTabs()) this.#send(tabId, 'off');
  }

  /** A run's status changed. Never waits on a page. */
  async status(conversationId: string, status: RunStatus): Promise<void> {
    if (status === 'running') this.#running.add(conversationId);
    else this.#running.delete(conversationId);
    for (const tabId of await this.ports.tabsOf(conversationId)) await this.#apply(tabId);
  }

  /** Tabs joined or left a conversation. */
  async tabsChanged(added: number[], removed: number[]): Promise<void> {
    for (const tabId of added) await this.#apply(tabId);
    for (const tabId of removed) this.#send(tabId, 'off');
  }

  /** A new document committed in a tab's top frame (a back-forward cache restore included). */
  async committed(tabId: number, documentId?: string): Promise<void> {
    if (await this.#wanted(tabId)) this.#send(tabId, this.#capturing.get(tabId) ? 'hidden' : 'on', documentId);
  }

  /** The Settings switch changed. */
  async settingChanged(): Promise<void> {
    for (const tabId of await this.ports.scopedTabs()) await this.#apply(tabId);
  }

  /** Broadcasts an overlay cursor update to a tab where the agent is acting. */
  cursor(tabId: number, data: CursorUpdate): void {
    chrome.tabs.sendMessage(tabId, { type: 'mars:cursor', ...data }).catch(() => undefined);
  }

  /**
   * A screenshot of a tab: the border fades out first, waiting at most HIDE_WAIT_MS, and comes back after. A tab with
   * no border is captured at once. Screenshots of one tab that overlap share one fade: a second 'hidden' would return
   * at once while the first is still fading.
   */
  async around<T>(tabId: number, capture: () => Promise<T>): Promise<T> {
    if (!(await this.#wanted(tabId))) return capture();
    const count = this.#capturing.get(tabId) ?? 0;
    this.#capturing.set(tabId, count + 1);
    if (!count) this.#hiding.set(tabId, this.#hide(tabId));
    try {
      await this.#hiding.get(tabId);
      return await capture();
    } finally {
      const left = (this.#capturing.get(tabId) ?? 1) - 1;
      if (left > 0) this.#capturing.set(tabId, left);
      else {
        this.#capturing.delete(tabId);
        this.#hiding.delete(tabId);
        void this.#apply(tabId);
      }
    }
  }

  async #hide(tabId: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.ports.inject(tabId, 'hidden').catch(() => undefined),
      new Promise<void>(resolve => (timer = setTimeout(resolve, HIDE_WAIT_MS))),
    ]);
    clearTimeout(timer);
  }

  async #wanted(tabId: number): Promise<boolean> {
    const conversationId = await this.ports.conversationOf(tabId);
    return conversationId !== null && this.#running.has(conversationId) && (await this.ports.enabled());
  }

  async #apply(tabId: number): Promise<void> {
    if (!(await this.#wanted(tabId))) return this.#send(tabId, 'off');
    if (!this.#capturing.get(tabId)) this.#send(tabId, 'on');
  }

  /** Started and not waited for: a page with a dialog open holds an injection until the dialog closes. */
  #send(tabId: number, state: BorderState, documentId?: string): void {
    void this.ports.inject(tabId, state, documentId).catch(() => undefined);
  }
}

/**
 * Runs in the page, in the extension's isolated world, passed whole to chrome.scripting.executeScript: it must not use
 * anything from outside its own body. It keeps its element on the isolated world's globalThis, which page script
 * cannot see, so later calls find it (a closed shadow root cannot be reached from its host).
 */
export function setBorder(state: BorderState): Promise<void> | void {
  const KEY = '__marsBorder';
  type CursorItem = {
    container: HTMLElement;
    ripple: HTMLElement;
    badgeText: HTMLElement;
    posX: number;
    posY: number;
    badgeTimeout?: ReturnType<typeof setTimeout>;
  };
  type Border = {
    host: HTMLElement;
    glow: HTMLElement;
    cursors: Map<string, CursorItem>;
    timer: ReturnType<typeof setInterval>;
    onHide: () => void;
    cleanup: () => void;
  };
  const g = globalThis as unknown as Record<string, Border | undefined>;
  const remove = () => {
    const b = g[KEY];
    if (!b) return;
    clearInterval(b.timer);
    removeEventListener('pagehide', b.onHide);
    b.cleanup();
    b.host.remove();
    g[KEY] = undefined;
  };
  if (state === 'off') return remove();
  let b = g[KEY];
  if (!b || !b.host.isConnected) {
    remove();
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-mars-border', '');
    host.setAttribute('data-nanobrowser-border', '');
    host.style.cssText =
      'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;contain:strict';
    const root = host.attachShadow({ mode: 'closed' });
    const blue = 'rgb(0 115 220 / 0.6)';
    const violet = 'rgb(124 92 255 / 0.6)';
    const along = (side: string) => `linear-gradient(${side}, ${violet}, ${blue} 25%, ${blue} 75%, ${violet})`;
    root.innerHTML = `<style>
      .glow { position: absolute; inset: 0; transition: opacity 150ms ease; pointer-events: none; }
      .pulse { position: absolute; inset: 0; animation: breathe 2s ease-in-out infinite alternate; }
      @keyframes breathe { from { opacity: 0.6; } to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
      .edge { position: absolute; }
      .t, .b { left: 0; right: 0; height: 16px; background: ${along('to right')}; }
      .l, .r { top: 0; bottom: 0; width: 16px; background: ${along('to bottom')}; }
      .t { top: 0; mask-image: linear-gradient(to bottom, #000, transparent); }
      .b { bottom: 0; mask-image: linear-gradient(to top, #000, transparent); }
      .l { left: 0; mask-image: linear-gradient(to right, #000, transparent); }
      .r { right: 0; mask-image: linear-gradient(to left, #000, transparent); }

      .mars-cursor {
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        z-index: 2147483647;
        transform: translate3d(-100px, -100px, 0);
        transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
        will-change: transform, opacity;
        opacity: 0;
      }
      .mars-cursor.visible { opacity: 1; }
      .mars-pointer {
        position: absolute;
        top: 0;
        left: 0;
        transform: translate(-1px, -1px);
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.45));
      }
      .mars-badge {
        position: absolute;
        top: 18px;
        left: 16px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px 3px 6px;
        border-radius: 9999px;
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid rgba(255, 112, 67, 0.55);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35), 0 0 10px rgba(255, 112, 67, 0.25);
        backdrop-filter: blur(8px);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        font-weight: 600;
        color: #FFFFFF;
        letter-spacing: 0.02em;
        white-space: nowrap;
        user-select: none;
        transition: all 0.15s ease;
      }
      .mars-badge-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #FF7043;
        box-shadow: 0 0 6px #FF7043;
        animation: marsPulse 1.5s ease-in-out infinite alternate;
      }
      @keyframes marsPulse {
        from { opacity: 0.6; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1.2); }
      }
      .mars-ripple {
        position: absolute;
        top: 0;
        left: 0;
        width: 44px;
        height: 44px;
        margin-top: -22px;
        margin-left: -22px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255, 112, 67, 0.7) 0%, rgba(255, 87, 34, 0.2) 60%, transparent 100%);
        border: 1.5px solid rgba(255, 112, 67, 0.85);
        opacity: 0;
        transform: scale(0);
        pointer-events: none;
      }
      .mars-ripple.animate {
        animation: marsRipple 0.45s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
      }
      @keyframes marsRipple {
        0% { transform: scale(0.1); opacity: 1; }
        50% { opacity: 0.8; }
        100% { transform: scale(1.3); opacity: 0; }
      }
    </style>
    <div class="glow"><div class="pulse"><div class="edge t"></div><div class="edge b"></div><div class="edge l"></div><div class="edge r"></div></div></div>`;
    document.documentElement.appendChild(host);

    const glow = root.querySelector('.glow') as HTMLElement;
    const cursors = new Map<string, CursorItem>();

    const THEMES = [
      { name: 'orange', start: '#FF7043', end: '#E64A19' },
      { name: 'blue', start: '#38BDF8', end: '#0284C7' },
      { name: 'purple', start: '#A855F7', end: '#7C3AED' },
      { name: 'emerald', start: '#34D399', end: '#059669' },
    ];

    const strHash = (s: string): number => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
      return Math.abs(h);
    };

    const getOrCreateCursor = (id = 'mars'): CursorItem => {
      let item = cursors.get(id);
      if (item && item.container.isConnected) return item;

      const theme = THEMES[strHash(id) % THEMES.length];
      const container = document.createElement('div');
      container.className = 'mars-cursor';
      container.setAttribute('data-cursor-id', id);
      container.innerHTML = `
        <div class="mars-ripple" style="border-color: ${theme.start}; background: radial-gradient(circle, ${theme.start}88 0%, ${theme.end}33 60%, transparent 100%);"></div>
        <svg class="mars-pointer" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="mpg-${id}" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="${theme.start}" />
              <stop offset="100%" stop-color="${theme.end}" />
            </linearGradient>
          </defs>
          <path d="M3 2L19 9.5L11.5 12.5L8.5 20L3 2Z" fill="url(#mpg-${id})" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
        <div class="mars-badge" style="border-color: ${theme.start}88; box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 0 10px ${theme.start}44;">
          <span class="mars-badge-dot" style="background: ${theme.start}; box-shadow: 0 0 6px ${theme.start};"></span>
          <span class="mars-badge-text">${id === 'mars' || id === 'default' ? 'Mars' : id}</span>
        </div>
      `;
      root.appendChild(container);

      const ripple = container.querySelector('.mars-ripple') as HTMLElement;
      const badgeText = container.querySelector('.mars-badge-text') as HTMLElement;
      item = {
        container,
        ripple,
        badgeText,
        posX: Math.round(window.innerWidth / 2),
        posY: Math.round(window.innerHeight / 2),
      };
      cursors.set(id, item);
      return item;
    };

    // The cursor is 100% independent: it listens ONLY to agent messages from the extension.
    // It does NOT listen to user mousemove, mousedown, or keydown events, ensuring user movements never interrupt it.
    const onMessage = (msg: {
      type?: string;
      id?: string;
      x?: number;
      y?: number;
      action?: string;
      label?: string;
    }) => {
      if (msg && msg.type === 'mars:cursor') {
        const curId = msg.id || 'mars';
        const cur = getOrCreateCursor(curId);
        if (typeof msg.x === 'number' && typeof msg.y === 'number') {
          cur.posX = Math.round(msg.x);
          cur.posY = Math.round(msg.y);
          cur.container.style.transform = `translate3d(${cur.posX}px, ${cur.posY}px, 0)`;
          cur.container.classList.add('visible');
        }
        if (msg.action === 'click') {
          cur.ripple.classList.remove('animate');
          void cur.ripple.offsetWidth;
          cur.ripple.classList.add('animate');
        }
        if (msg.label) {
          if (cur.badgeTimeout) clearTimeout(cur.badgeTimeout);
          cur.badgeText.textContent = msg.label;
          const defaultLabel = curId === 'mars' || curId === 'default' ? 'Mars' : curId;
          if (msg.label !== defaultLabel) {
            cur.badgeTimeout = setTimeout(() => {
              cur.badgeText.textContent = defaultLabel;
            }, 1200);
          }
        }
      }
    };

    const runtime = globalThis.chrome?.runtime;
    if (runtime?.onMessage) {
      runtime.onMessage.addListener(onMessage);
    }

    const cleanup = () => {
      if (runtime?.onMessage) runtime.onMessage.removeListener(onMessage);
      cursors.forEach(cur => {
        if (cur.badgeTimeout) clearTimeout(cur.badgeTimeout);
        cur.container.remove();
      });
      cursors.clear();
    };

    // A page kept in the back-forward cache keeps its DOM, and its timers wait: it must not keep a border or cursor.
    const onHide = () => remove();
    addEventListener('pagehide', onHide);
    // When the extension is updated, reloaded, turned off or removed, its id is gone, and the overlay goes with it.
    const timer = setInterval(() => {
      if (!globalThis.chrome?.runtime?.id) remove();
    }, 2000);
    b = { host, glow, cursors, timer, onHide, cleanup };
    g[KEY] = b;
  }
  const glow = b.glow;
  const cursors = b.cursors;
  if (state === 'on') {
    glow.style.opacity = '1';
    cursors.forEach(cur => {
      cur.container.classList.add('visible');
      cur.container.style.transform = `translate3d(${cur.posX}px, ${cur.posY}px, 0)`;
    });
    return;
  }
  let hasVisible = false;
  cursors.forEach(cur => {
    if (cur.container.classList.contains('visible')) hasVisible = true;
    cur.container.classList.remove('visible');
  });
  if (glow.style.opacity === '0' && !hasVisible) return;
  // A hidden tab paints nothing until the capture, so the border and cursor can go at once.
  if (document.visibilityState === 'hidden') {
    glow.style.transition = 'none';
    glow.style.opacity = '0';
    return;
  }
  glow.style.transition = '';
  return new Promise<void>(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // One frame so the faded state is painted before the capture.
      requestAnimationFrame(() => resolve());
    };
    glow.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 200);
    glow.style.opacity = '0';
  });
}

/** Puts `setBorder(state)` into the top frame of a tab, or into one document of it. */
export async function injectBorder(tabId: number, state: BorderState, documentId?: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: documentId ? { tabId, documentIds: [documentId] } : { tabId },
    func: setBorder,
    args: [state],
    injectImmediately: true,
  });
}

/** New documents in a tab's top frame, and the Settings switch. Registered at worker start. */
export function listenForBorder(border: PageBorder): void {
  chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId === 0) void border.committed(details.tabId, details.documentId).catch(() => undefined);
  });
  let enabled: boolean | undefined;
  settingsStorage.subscribe(() => {
    const next = settingsStorage.getSnapshot()?.pageBorder;
    if (next === undefined || next === enabled) return;
    const changed = enabled !== undefined;
    enabled = next;
    if (changed) void border.settingChanged().catch(() => undefined);
  });
  void settingsStorage.get().then(settings => (enabled ??= settings?.pageBorder));
}
