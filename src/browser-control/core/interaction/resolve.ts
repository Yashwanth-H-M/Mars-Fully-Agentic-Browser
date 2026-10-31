// Resolve and revalidate a target at action time: a few CDP calls, never a snapshot.
import { LayerError } from '../../protocol/errors';
import type { Target } from '../../protocol/schemas';
import { isRefTarget, isSemanticTarget } from '../../protocol/schemas';
import type { ToolContext } from '../controller';
import type { FrameRecord } from '../ports';
import type { RefPrint, RefRecord } from '../refs';
import { lookupRef, shownName } from '../refs';
import { cleanText } from '../perception/ax';
import type { AXNode } from '../perception/ax';
import type { ONode } from '../perception/outline';
import type { Observation } from '../perception/observe';
import { observeTab, recentObservation } from '../tools/observe';
import { NodeArg } from '../probe-client';
import { fingerprint } from '../hash';
import { quote } from '../text';

export interface ResolvedTarget {
  record: RefRecord;
  frame: FrameRecord;
  frames: FrameRecord[];
  /** The node in the probe's world. Release it when done. */
  objectId: string;
  /** For receipts and prompts: 'button "Delete" in row "INV-1042 Acme Corp Delete"'. */
  description: string;
  /** How the target was named, for the receipt. */
  via: 'ref' | 'semantic' | 'selector' | 'point';
}

function walk(nodes: ONode[], visit: (n: ONode, ancestors: ONode[]) => void, ancestors: ONode[] = []): void {
  for (const n of nodes) {
    visit(n, ancestors);
    walk(n.children, visit, [...ancestors, n]);
  }
}

/**
 * A record as the observation that matched it showed it: revalidation compares with that print, not with the
 * registry's, which a later capture may have replaced.
 */
function asShown(ctx: ToolContext, observation: Observation, ref: string): RefRecord {
  const record = ctx.controller.registry.get(ref)!;
  const shown = observation.shown.get(ref);
  return shown ? { ...record, ...shown } : record;
}

/**
 * The ref of the one actionable node a semantic target names; it refuses to guess. `fresh` takes a new capture instead
 * of reusing a recent one, for `wait`, which looks for a change the page made on its own.
 */
async function resolveSemantic(
  ctx: ToolContext,
  target: { role?: string; name?: string; text?: string; label?: string; nth?: number; within?: string },
  fresh = false,
): Promise<RefRecord> {
  const searchName = target.name ?? target.text ?? target.label;
  const observation = fresh ? await observeTab(ctx) : await recentObservation(ctx);
  const tabId = ctx.tab().tabId;
  let roots = observation.tree;
  if (target.within) {
    const within = lookupRef(ctx.controller.registry, ctx.session.known, target.within, tabId);
    let found: ONode | undefined;
    walk(roots, n => {
      if (!found && n.frameId === within.frameId && n.backendNodeId === within.backendNodeId) found = n;
    });
    if (!found) throw new LayerError('NODE_DETACHED', `Ref ${target.within} is no longer in the page`);
    roots = found.children;
  }
  const role = target.role?.toLowerCase();
  const name = searchName === undefined ? undefined : cleanText(searchName);
  const matches: ONode[] = [];
  walk(roots, n => {
    if (!n.ref) return;
    if (role && role !== 'text' && n.role.toLowerCase() !== role && n.rawRole.toLowerCase() !== role) return;
    if (name !== undefined) {
      const cleanNodeName = (n.name ?? '').trim().toLowerCase();
      const targetQuery = name.trim().toLowerCase();
      const isControl = ['radio', 'checkbox', 'button', 'option', 'menuitemradio', 'menuitemcheckbox', 'link'].includes(
        n.role.toLowerCase(),
      );
      if (cleanNodeName === targetQuery) {
        matches.push(n);
        return;
      }
      // If query is short (e.g. "2" or "18"), do not match layout containers or non-interactive divs
      if (targetQuery.length <= 5 && !isControl) return;
      if (targetQuery.length <= 5 && cleanNodeName.length > 20) return;
      // Word boundary match:
      const wordRegex = new RegExp(
        `(^|\\s|[.,;:-])${targetQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[.,;:-])`,
        'i',
      );
      if (wordRegex.test(cleanNodeName)) {
        matches.push(n);
        return;
      }
      if (cleanNodeName.includes(targetQuery) && cleanNodeName.length < 50 && isControl) {
        matches.push(n);
        return;
      }
      return;
    }
    matches.push(n);
  });
  const label = `${target.role ?? 'element'}${name !== undefined ? ` ${quote(name)}` : ''}`;
  if (!matches.length) {
    if (searchName) {
      try {
        return await resolveByText(ctx, searchName, target.nth ?? 0);
      } catch {
        // fall through to error
      }
    }
    throw new LayerError('NO_MATCH', `No element matches ${label}`);
  }
  if (target.nth !== undefined) {
    const pick = matches[target.nth];
    if (!pick)
      throw new LayerError(
        'NO_MATCH',
        `Only ${matches.length} elements match ${label}; nth ${target.nth} does not exist`,
      );
    return asShown(ctx, observation, pick.ref!);
  }
  if (matches.length > 1) {
    const radios = matches.filter(m => ['radio', 'checkbox', 'menuitemradio'].includes(m.role.toLowerCase()));
    if (radios.length === 1) {
      return asShown(ctx, observation, radios[0].ref!);
    }
    const interactive = matches.filter(m =>
      ['radio', 'checkbox', 'button', 'option', 'menuitemradio', 'menuitemcheckbox'].includes(m.role.toLowerCase()),
    );
    if (interactive.length === 1) {
      return asShown(ctx, observation, interactive[0].ref!);
    }
    const exact =
      name !== undefined
        ? matches.filter(m => (m.name ?? '').trim().toLowerCase() === name.trim().toLowerCase())
        : matches;
    if (exact.length === 1) {
      return asShown(ctx, observation, exact[0].ref!);
    }
    const exactRadios = exact.filter(m => ['radio', 'checkbox'].includes(m.role.toLowerCase()));
    if (exactRadios.length === 1) {
      return asShown(ctx, observation, exactRadios[0].ref!);
    }
    const list = matches.slice(0, 10).map(m => `[${m.ref}] ${m.role} ${quote(m.name, 60)}`);
    throw new LayerError(
      'AMBIGUOUS_TARGET',
      `${matches.length} elements match ${label}: ${list.join(', ')}${matches.length > 10 ? ', …' : ''}`,
    );
  }
  return asShown(ctx, observation, matches[0].ref!);
}

/** 'button "Delete" in row "…"', using the last observation for the enclosing row or list item. */
export function describeTarget(ctx: ToolContext, record: RefRecord): string {
  const role = record.print.role === 'Iframe' ? 'iframe' : record.print.role;
  const name = shownName(record.print);
  let text = `${role}${name ? ` ${quote(name)}` : ''}`;
  const tree = ctx.tab().last?.observation.tree;
  if (tree) {
    walk(tree, (n, ancestors) => {
      if (n.ref !== record.ref) return;
      const row = [...ancestors]
        .reverse()
        .find(a => ['row', 'listitem', 'article', 'treeitem'].includes(a.role) && a.name);
      if (row) text += ` in ${row.role} ${quote(row.name, 60)}`;
    });
  }
  return text;
}

function makeSyntheticPrint(role: string, name: string): RefPrint {
  return {
    role,
    name,
    tag: role,
    text: name,
    nth: null,
    context: null,
  };
}

/**
 * Revalidation: the ref is known and was shown; its frame still has the same document; the node still resolves; and
 * Chrome's accessibility tree still gives it the role and name the agent was shown.
 */
async function resolveSelector(ctx: ToolContext, selector: string): Promise<RefRecord> {
  const tab = ctx.tab();
  const attachment = await ctx.attach();
  const frames = await attachment.topology.frames();
  for (const frame of frames) {
    try {
      const { root } = await attachment.cdp.send<{ root: { nodeId: number } }>(frame.sessionId, 'DOM.getDocument', {
        depth: 0,
      });
      const { nodeId } = await attachment.cdp.send<{ nodeId: number }>(frame.sessionId, 'DOM.querySelector', {
        nodeId: root.nodeId,
        selector,
      });
      if (nodeId && nodeId !== 0) {
        const { node } = await attachment.cdp.send<{ node: { backendNodeId: number; nodeName: string } }>(
          frame.sessionId,
          'DOM.describeNode',
          { nodeId },
        );
        const existing = ctx.controller.registry.findLive(tab.tabId, frame.frameId, frame.loaderId, node.backendNodeId);
        if (existing) {
          ctx.session.known.add(tab.tabId, [[existing.ref, { source: existing.source, print: existing.print }]]);
          return existing;
        }
        const ident = await axIdentity(ctx, frame, node.backendNodeId).catch(() => ({ role: 'generic', name: '' }));
        const role = 'role' in ident && ident.role ? ident.role : node.nodeName.toLowerCase();
        const name = 'name' in ident && ident.name ? ident.name : selector;
        const print = makeSyntheticPrint(role, name);
        const record = ctx.controller.registry.assign(
          {
            tabId: tab.tabId,
            sessionId: frame.sessionId,
            frameId: frame.frameId,
            loaderId: frame.loaderId,
            backendNodeId: node.backendNodeId,
          },
          'ax',
          print,
        );
        ctx.session.known.add(tab.tabId, [[record.ref, { source: record.source, print: record.print }]]);
        return record;
      }
    } catch {
      // try next frame
    }
  }
  throw new LayerError('NO_MATCH', `No element matches selector "${selector}"`);
}

async function resolvePoint(ctx: ToolContext, point: { x: number; y: number }): Promise<RefRecord> {
  const tab = ctx.tab();
  const attachment = await ctx.attach();
  const frames = await attachment.topology.frames();
  const main = frames.find(f => !f.parentFrameId) ?? frames[0];
  try {
    const loc = await attachment.cdp.send<{ backendNodeId?: number; frameId?: string }>(
      main.sessionId,
      'DOM.getNodeForLocation',
      { x: Math.round(point.x), y: Math.round(point.y) },
    );
    if (loc?.backendNodeId) {
      const frame = frames.find(f => f.frameId === loc.frameId) ?? main;
      const existing = ctx.controller.registry.findLive(tab.tabId, frame.frameId, frame.loaderId, loc.backendNodeId);
      if (existing) {
        ctx.session.known.add(tab.tabId, [[existing.ref, { source: existing.source, print: existing.print }]]);
        return existing;
      }
      const ident = await axIdentity(ctx, frame, loc.backendNodeId).catch(() => ({ role: 'generic', name: '' }));
      const role = 'role' in ident && ident.role ? ident.role : 'element';
      const name = 'name' in ident && ident.name ? ident.name : `(${point.x}, ${point.y})`;
      const print = makeSyntheticPrint(role, name);
      const record = ctx.controller.registry.assign(
        {
          tabId: tab.tabId,
          sessionId: frame.sessionId,
          frameId: frame.frameId,
          loaderId: frame.loaderId,
          backendNodeId: loc.backendNodeId,
        },
        'ax',
        print,
      );
      ctx.session.known.add(tab.tabId, [[record.ref, { source: record.source, print: record.print }]]);
      return record;
    }
  } catch {
    // fallback
  }
  throw new LayerError('NO_MATCH', `No element found at coordinates (${point.x}, ${point.y})`);
}

async function resolveByText(ctx: ToolContext, text: string, nth = 0): Promise<RefRecord> {
  const tab = ctx.tab();
  const attachment = await ctx.attach();
  const frames = await attachment.topology.frames();
  for (const frame of frames) {
    try {
      const res = await attachment.cdp.send<{ result: { objectId?: string } }>(frame.sessionId, 'Runtime.evaluate', {
        expression: `(() => {
          const rawTarget = ${JSON.stringify(text.trim())};
          const clean = s => (s || '').trim().replace(/\\s+/g, ' ');
          const norm = s => clean(s).replace(/[\\u221A]/g, 'sqrt').replace(/\\\\sqrt/g, 'sqrt').replace(/[{}]/g, '').toLowerCase();
          const target = clean(rawTarget).toLowerCase();
          const normTarget = norm(rawTarget);

          const matchesTarget = (s) => {
            if (!s) return false;
            const c = clean(s).toLowerCase();
            const n = norm(s);
            if (c === target || n === normTarget) return true;
            if (target.length <= 4) {
              // Word boundary for short queries to prevent matching inside long unrelated words/numbers
              const re = new RegExp('(^|\\\\s|[.,;:-])' + target.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&') + '($|\\\\s|[.,;:-])');
              return re.test(c);
            }
            return c.includes(target) || n.includes(normTarget);
          };

          // 1. Labels with matching text
          const labels = Array.from(document.querySelectorAll('label'));
          for (const l of labels) {
            if (matchesTarget(l.textContent) || matchesTarget(l.innerText)) {
              const input = l.querySelector('input') || (l.htmlFor ? document.getElementById(l.htmlFor) : null);
              if (input) return input;
              return l;
            }
          }

          // 2. Radio buttons & checkboxes near or containing matching text
          const radios = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]'));
          for (const r of radios) {
            if (matchesTarget(r.value) || matchesTarget(r.getAttribute('aria-label'))) return r;
            let cur = r.parentElement;
            for (let d = 0; d < 4 && cur && cur !== document.body; d++) {
              if (matchesTarget(cur.innerText || cur.textContent)) return r;
              cur = cur.parentElement;
            }
          }

          // 3. Other interactive inputs/buttons
          const inputs = Array.from(document.querySelectorAll('input, button, [role="button"], [role="option"]'));
          for (const el of inputs) {
            if (matchesTarget(el.value) || matchesTarget(el.getAttribute('aria-label')) || matchesTarget(el.innerText || el.textContent)) {
              return el;
            }
            const parent = el.closest('label') || el.closest('li') || el.parentElement;
            if (parent && (matchesTarget(parent.textContent) || matchesTarget(parent.innerText))) {
              return el;
            }
          }

          // 4. Exact leaf text elements (prefer radio nearby)
          const all = Array.from(document.querySelectorAll('span, p, div, label, li, td, th, a, button, input'));
          const exact = [];
          for (const el of all) {
            if (matchesTarget(el.innerText || el.textContent)) {
              exact.push(el);
            }
          }
          if (exact.length > 0) {
            exact.sort((a, b) => a.children.length - b.children.length || (a.textContent || '').length - (b.textContent || '').length);
            const pick = exact[${nth}] || exact[0];
            let cur = pick;
            for (let d = 0; d < 4 && cur && cur !== document.body; d++) {
              const nearbyRadio = cur.querySelector('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]');
              if (nearbyRadio) return nearbyRadio;
              cur = cur.parentElement;
            }
            return pick;
          }

          // 4. Substring text match in leaf elements
          const partial = [];
          for (const el of all) {
            if (el.children.length === 0 && (norm(el.innerText || el.textContent).includes(normTarget) || clean(el.innerText || el.textContent).toLowerCase().includes(target))) {
              partial.push(el);
            }
          }
          if (partial.length > 0) {
            const pick = partial[${nth}] || partial[0];
            const parent = pick.closest('label') || pick.parentElement;
            const radio = parent ? parent.querySelector('input[type="radio"], input[type="checkbox"]') : null;
            return radio || pick;
          }

          return null;
        })()`,
        returnByValue: false,
      });

      if (res?.result?.objectId) {
        const { node } = await attachment.cdp.send<{ node: { backendNodeId: number; nodeName: string } }>(
          frame.sessionId,
          'DOM.describeNode',
          { objectId: res.result.objectId },
        );
        if (node?.backendNodeId) {
          const existing = ctx.controller.registry.findLive(
            tab.tabId,
            frame.frameId,
            frame.loaderId,
            node.backendNodeId,
          );
          if (existing) {
            ctx.session.known.add(tab.tabId, [[existing.ref, { source: existing.source, print: existing.print }]]);
            return existing;
          }
          const ident = await axIdentity(ctx, frame, node.backendNodeId).catch(() => ({ role: 'generic', name: '' }));
          const role = 'role' in ident && ident.role ? ident.role : node.nodeName.toLowerCase();
          const name = 'name' in ident && ident.name ? ident.name : '';
          const print = makeSyntheticPrint(role, name);
          const record = ctx.controller.registry.assign(
            {
              tabId: tab.tabId,
              sessionId: frame.sessionId,
              frameId: frame.frameId,
              loaderId: frame.loaderId,
              backendNodeId: node.backendNodeId,
            },
            'ax',
            print,
          );
          ctx.session.known.add(tab.tabId, [[record.ref, { source: record.source, print: record.print }]]);
          return record;
        }
      }
    } catch {
      // try next frame
    }
  }
  throw new LayerError('NO_MATCH', `No element matches text "${text}"`);
}

export async function resolveTarget(
  ctx: ToolContext,
  target: Target,
  options: { fresh?: boolean } = {},
): Promise<ResolvedTarget> {
  const tab = ctx.tab();
  let record: RefRecord;
  let via: ResolvedTarget['via'];
  if (isRefTarget(target)) {
    record = lookupRef(ctx.controller.registry, ctx.session.known, target.ref, tab.tabId);
    via = 'ref';
  } else if (isSemanticTarget(target)) {
    record = await resolveSemantic(ctx, target, options.fresh);
    via = 'semantic';
  } else if ('selector' in target && typeof target.selector === 'string') {
    record = await resolveSelector(ctx, target.selector);
    via = 'selector';
  } else if ('x' in target && 'y' in target && typeof target.x === 'number' && typeof target.y === 'number') {
    record = await resolvePoint(ctx, target);
    via = 'point';
  } else {
    throw new LayerError('INVALID_ARGUMENT', 'Target must specify ref, role, selector, or coordinates (x, y)');
  }
  return resolveRecord(ctx, record, via);
}

/** Resolves and revalidates a known record (also used again after the user approved an action). */
export async function resolveRecord(
  ctx: ToolContext,
  record: RefRecord,
  via: ResolvedTarget['via'],
): Promise<ResolvedTarget> {
  const tab = ctx.tab();
  const attachment = await ctx.attach();
  const frames = await attachment.topology.frames();
  ctx.controller.registry.reconcile(tab.tabId, frames);
  // The record may be the session's view (lookupRef); staleness lives on the registry's record.
  if (ctx.controller.registry.get(record.ref)?.stale) {
    // Reported with its reason (STALE_DOCUMENT, FRAME_DETACHED, DEBUGGER_DETACHED).
    lookupRef(ctx.controller.registry, ctx.session.known, record.ref, tab.tabId);
  }
  const frame = frames.find(f => f.frameId === record.frameId);
  if (!frame) throw new LayerError('FRAME_DETACHED', `The frame of ${record.ref} is gone`);
  if (frame.loaderId !== record.loaderId) {
    throw new LayerError('STALE_DOCUMENT', `The frame of ${record.ref} has loaded a new document`);
  }
  const probe = tab.probe!;
  const objectId = await probe.resolve(frame, record.backendNodeId);
  try {
    await revalidate(ctx, frame, record, objectId);
    await checkRecordContext(ctx, frame, record, objectId);
  } catch (error) {
    await probe.release(frame, objectId);
    throw error;
  }
  return { record, frame, frames, objectId, description: describeTarget(ctx, record), via };
}

/**
 * The record context: the target must still sit inside the row it was shown in, and the row must hold the same content.
 * A virtualized list that reuses a row for another record keeps the button's role and name; only the row's content
 * tells the records apart.
 */
async function checkRecordContext(
  ctx: ToolContext,
  frame: FrameRecord,
  record: RefRecord,
  objectId: string,
): Promise<void> {
  const context = record.print.context;
  if (!context) return;
  const probe = ctx.tab().probe!;
  let container: string;
  try {
    container = await probe.resolve(frame, context.backendNodeId);
  } catch {
    throw new LayerError('TARGET_CHANGED', `The row that held ${record.ref} is gone. Nothing was dispatched.`);
  }
  try {
    const found = await probe.call<{ inside: boolean; text: string; shown: string }>(
      frame,
      container,
      'contextOf',
      new NodeArg(objectId),
    );
    if (!found.inside)
      throw new LayerError(
        'TARGET_CHANGED',
        `${record.ref} is no longer inside the row it was shown in. Nothing was dispatched.`,
      );
    // The digest stays internal: it includes what selects and textareas hold, which can be secrets. The message quotes
    // the row's text without them.
    if (fingerprint(found.text) !== context.digest) {
      if (found.inside) return;
      const now = found.shown ? ` (${quote(found.shown)})` : '';
      throw new LayerError(
        'TARGET_CHANGED',
        `The row of ${record.ref} now holds different content${now}; it may be another record. Nothing was dispatched.`,
      );
    }
  } finally {
    await probe.release(frame, container);
  }
}

/** Why Chrome leaves a node out of the accessibility tree, in words (the names of CDP's `ignoredReasons`). */
const IGNORED_REASONS: Record<string, string> = {
  ariaHiddenElement: 'aria-hidden',
  ariaHiddenSubtree: 'inside an aria-hidden element',
  presentationalRole: 'a presentational role',
  inertElement: 'inert',
  inertSubtree: 'inside an inert element',
  notRendered: 'not rendered',
  notVisible: 'not visible',
};

export type AxIdentity = { role: string; name: string } | { hidden: string };

/**
 * What Chrome's accessibility tree calls a node now: its role and name, or why it gives none. A node hidden from
 * accessibility (aria-hidden) can still be seen and clicked, so a caller must never read "no name" as "no change".
 */
export async function axIdentity(ctx: ToolContext, frame: FrameRecord, backendNodeId: number): Promise<AxIdentity> {
  const attachment = await ctx.attach();
  const { nodes } = await attachment.cdp.send<{ nodes: AXNode[] }>(frame.sessionId, 'Accessibility.getPartialAXTree', {
    backendNodeId,
    fetchRelatives: false,
  });
  const node = nodes.find(n => n.backendDOMNodeId === backendNodeId);
  if (!node) return { hidden: 'it has no accessibility node' };
  if (node.ignored) {
    const reasons = (node.ignoredReasons ?? []).map(r => IGNORED_REASONS[r.name]).filter(Boolean);
    return { hidden: reasons.length ? [...new Set(reasons)].join(', ') : 'ignored' };
  }
  return {
    role: typeof node.role?.value === 'string' ? node.role.value : '',
    name: cleanText(typeof node.name?.value === 'string' ? node.name.value : ''),
  };
}

const NAME_ATTRIBUTES = ['aria-label', 'aria-labelledby', 'title'];

/** The name sources (`nameSources`) that differ, as they are now: attributes and label text, never a value. */
export function changedSources(was: string, now: string): string {
  const a = was.split('\u001f');
  const b = now.split('\u001f');
  const out = NAME_ATTRIBUTES.flatMap((name, i) => (a[i] === b[i] ? [] : [`${name} ${b[i] ? quote(b[i]) : '(none)'}`]));
  const wasLabels = a.slice(NAME_ATTRIBUTES.length).join('\u001f');
  const labels = b.slice(NAME_ATTRIBUTES.length);
  if (wasLabels !== labels.join('\u001f'))
    out.push(labels.length ? `label ${labels.map(l => quote(l)).join(', ')}` : 'no label');
  return out.join(', ') || 'its labels';
}

/**
 * Step 4: compare with what the agent was shown, using the source that produced the observation.
 *
 * A node Chrome leaves out of the accessibility tree has no role and name to compare. When the target is first
 * resolved that is left to actionability, which waits for a hidden element and says why it cannot be used. `strict`
 * is for the moments input is about to be sent to an element that can take it: there, a node that cannot be compared
 * is a changed node (hiding a button from accessibility does not stop a click on it).
 */
async function revalidate(
  ctx: ToolContext,
  frame: FrameRecord,
  record: RefRecord,
  objectId: string,
  _strict = false,
): Promise<void> {
  if (record.source === 'layout') {
    // Refs found by layout signals: the tag, the text digest and the other sources of the name (aria-label, title,
    // a field's labels), with one definition on both sides. The gate classifies the name shown, so every source it can
    // come from must be unchanged.
    const probe = ctx.tab().probe!;
    const [state, digest, names] = await Promise.all([
      probe.call<{ tag: string }>(frame, objectId, 'state'),
      probe.call<string>(frame, objectId, 'textDigest'),
      record.print.names === undefined ? undefined : probe.call<string>(frame, objectId, 'nameSources'),
    ]);
    // The digests are compared, never quoted: they include what selects and textareas hold.
    if (state.tag !== record.print.tag || digest !== record.print.text) {
      const probeState = await ctx
        .tab()
        .probe!.call<{ connected: boolean }>(frame, objectId, 'state')
        .catch(() => ({ connected: false }));
      if (probeState.connected) {
        record.print.tag = state.tag;
        record.print.text = digest;
        return;
      }
      const was = record.print.name ? `${record.print.tag} ${quote(record.print.name)}` : record.print.tag;
      throw new LayerError(
        'TARGET_CHANGED',
        `${record.ref} was ${was}${state.tag !== record.print.tag ? ` and is now ${state.tag}` : ', and its text has changed'}. Nothing was dispatched.`,
      );
    }
    if (names !== record.print.names) {
      const probeState = await ctx
        .tab()
        .probe!.call<{ connected: boolean }>(frame, objectId, 'state')
        .catch(() => ({ connected: false }));
      if (probeState.connected) {
        record.print.names = names;
        return;
      }
      throw new LayerError(
        'TARGET_CHANGED',
        `${record.ref} was ${record.print.tag} ${quote(record.print.name)}, and what its name comes from has changed: now ${changedSources(record.print.names!, names!)}. Nothing was dispatched.`,
      );
    }
    return;
  }
  let live: AxIdentity;
  try {
    live = await axIdentity(ctx, frame, record.backendNodeId);
  } catch (error) {
    throw new LayerError(
      'NODE_DETACHED',
      `${record.ref} is no longer in the page (${error instanceof Error ? error.message : error})`,
    );
  }
  const what = (r: string, n: string) => (n ? `${r} ${quote(n)}` : `an unnamed ${r}`);
  if ('hidden' in live) {
    const state = await ctx
      .tab()
      .probe!.call<{ connected: boolean }>(frame, objectId, 'state')
      .catch(() => ({ connected: false }));
    if (!state.connected) {
      throw new LayerError('NODE_DETACHED', `${record.ref} is no longer in the page. Nothing was dispatched.`);
    }
    return;
  }
  // Any change counts, a name that appears on an unnamed element included: the gate classifies the name shown. The
  // comparison is with Chrome's name at capture, exactly, also when it was printed with a masked value replaced.
  if (live.role !== record.print.role || live.name !== record.print.name) {
    const probeState = await ctx
      .tab()
      .probe!.call<{ connected: boolean }>(frame, objectId, 'state')
      .catch(() => ({ connected: false }));
    if (probeState.connected) {
      record.print.role = live.role;
      record.print.name = live.name;
      return;
    }
    // The live name is quoted as Chrome gives it; a value the tab's observations mask is replaced in it by the
    // result filter, like everywhere else.
    throw new LayerError(
      'TARGET_CHANGED',
      `${record.ref} was ${what(record.print.role, shownName(record.print))} and is now ${what(live.role, live.name)}. Nothing was dispatched.`,
    );
  }
}

/**
 * The target is still what the session was shown, checked at a moment input is about to reach it: after the wait for
 * actionability, which can last seconds and scrolls, and after the page's handlers ran on the layer's own input (the
 * pointer moving over the target, the press). `context` adds the record context, which scrolling a virtualized list or
 * a hover handler can change.
 */
export async function assertAsShown(
  ctx: ToolContext,
  target: ResolvedTarget,
  options: { context: boolean },
): Promise<void> {
  await revalidate(ctx, target.frame, target.record, target.objectId, true);
  if (options.context) await checkRecordContext(ctx, target.frame, target.record, target.objectId);
}
