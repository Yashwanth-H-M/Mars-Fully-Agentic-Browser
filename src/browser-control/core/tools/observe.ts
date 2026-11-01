// The read-only tools: snapshot, find, read, screenshot. Observation is read-only.
import { LayerError } from '../../protocol/errors';
import type { FindArgs, ReadArgs, ScreenshotArgs, SnapshotArgs } from '../../protocol/schemas';
import type { FindMatch, ScreenshotData, SnapshotData } from '../../protocol/results';
import type { ToolContext, ToolOutcome } from '../controller';
import { lookupRef } from '../refs';
import type { RefRecord, Shown } from '../refs';
import { captureTier1 } from '../perception/capture';
import { buildObservation } from '../perception/observe';
import type { Observation } from '../perception/observe';
import type { ONode } from '../perception/outline';
import { renderLine } from '../perception/outline';
import { renderContent, sliceContent } from '../perception/read';
import { cleanText } from '../perception/ax';
import { quadBounds, scrollOffset, topLevelQuad } from '../geometry';
import { blankBoxes, drawLabels, presentedBoxes } from './labels';
import { compactOps, diffLines, renderDiff } from '../perception/diff';
import type { FrameRecord } from '../ports';
import { rememberSecret } from '../redact';
import { quote } from '../text';
import { resolveTarget } from '../interaction/resolve';
import type { ProbeState } from '../../probe';

/** A capture is reused by read-only helpers only right after it, with no action in between. */
const REUSE_MS = 2_000;

/** The refs with the print this observation showed for each. */
function shownOf(observation: Observation, refs: string[]): Array<[string, Shown]> {
  return refs.flatMap(ref => {
    const what = observation.shown.get(ref);
    return what ? [[ref, what] as [string, Shown]] : [];
  });
}

/** Captures the tab and builds an observation. Does not change the session's known set. */
export async function observeTab(
  ctx: ToolContext,
  options: { mode?: 'interactive' | 'all'; scope?: RefRecord; window?: 'viewport' | 'near' | 'page' } = {},
): Promise<Observation> {
  const attachment = await ctx.attach();
  const tab = ctx.tab();
  const capture = await captureTier1(tab.tabId, attachment.cdp, attachment.topology, tab.capture);
  ctx.controller.registry.reconcile(tab.tabId, capture.frames);
  if (capture.frames[0]?.status !== 'captured') {
    ctx.session.known.replace(tab.tabId, []);
    throw new LayerError(
      'CAPTURE_FAILED',
      `The page could not be captured: ${capture.frames[0]?.reason ?? 'no main frame'}`,
    );
  }
  const observation = buildObservation(capture, ctx.controller.registry, {
    mode: options.mode ?? 'all',
    window: options.window,
    scope: options.scope ? { frameId: options.scope.frameId, backendNodeId: options.scope.backendNodeId } : undefined,
    budget: ctx.session.config.budget,
  });
  for (const secret of observation.secrets) rememberSecret(tab.secrets, secret);
  if (!options.scope && (options.mode ?? 'all') === 'all') {
    tab.last = {
      observation,
      actionSeq: tab.actionSeq,
      at: Date.now(),
      loaders: capture.frames.map(f => [f.frameId, f.loaderId] as [string, string]),
    };
  }
  return observation;
}

/** The last full observation if it may be reused, else a new one. */
export async function recentObservation(ctx: ToolContext): Promise<Observation> {
  const tab = ctx.tab();
  const last = tab.last;
  if (last && last.actionSeq === tab.actionSeq && Date.now() - last.at < REUSE_MS && tab.attachment) {
    // Reuse only if no frame has loaded a new document since (a reload by the page or the user is not an action).
    const frames = await tab.attachment.topology.frames();
    const loaders = new Map(frames.map(f => [f.frameId, f.loaderId]));
    if (last.loaders.every(([frameId, loaderId]) => loaders.get(frameId) === loaderId)) return last.observation;
  }
  return observeTab(ctx);
}

export async function snapshot(
  ctx: ToolContext,
  args: SnapshotArgs,
  as: 'full' | 'diff' = 'full',
): Promise<ToolOutcome<SnapshotData>> {
  const tab = ctx.tab();
  const scope = args.scope ? lookupRef(ctx.controller.registry, ctx.session.known, args.scope, tab.tabId) : undefined;
  const observation = await observeTab(ctx, { mode: args.mode, scope, window: args.window });
  const previous = ctx.session.seen.get(tab.tabId);
  if (scope) ctx.session.known.add(tab.tabId, shownOf(observation, observation.refs));
  // A full outline, or a diff against it, leaves the known set equal to the fresh outline's refs: refs added by a
  // diff are accepted, refs it removed are not.
  else ctx.session.known.replace(tab.tabId, shownOf(observation, observation.refs));
  tab.rev++;
  const notices = [...observation.notices];
  const snapshotText = `${observation.header}\n${observation.body}`;
  const lines = snapshotText.split('\n');
  const data: SnapshotData = {
    status: observation.status,
    refs: observation.refs.length,
    frames: observation.frames,
    notices,
    captureMs: observation.captureMs,
  };
  const page = { tabId: tab.tabId, url: observation.url, title: observation.title, rev: tab.rev };
  if (!scope) ctx.session.seen.set(tab.tabId, { rev: tab.rev, lines });
  if (as === 'diff' && !scope && previous) {
    const ops = diffLines(previous.lines, lines);
    const changedLines = ops ? ops.filter(o => o.op !== 'keep').length : Infinity;
    // A diff larger than half the outline is no saving: the full outline is returned instead.
    if (ops && changedLines <= Math.max(10, lines.length / 2)) {
      const diff = renderDiff(ops, previous.rev);
      return {
        page: { ...page, changed: 'diff', snapshot: diff.text, diff: { since: previous.rev, ops: compactOps(ops) } },
        data: {
          ...data,
          diff: { since: previous.rev, ops: compactOps(ops), added: diff.added, removed: diff.removed },
        },
        lines: [
          `diff · tab ${tab.tabId} · rev ${previous.rev} → ${tab.rev} · +${diff.added.length} −${diff.removed.length} ~${diff.changed} refs`,
        ],
        pageText: diff.text,
        notices,
      };
    }
    notices.push('The changes are larger than half the outline; the full outline is returned.');
  } else if (as === 'diff' && !scope) {
    notices.push('No earlier outline of this tab was seen; the full outline is returned.');
  }
  return {
    page: { ...page, changed: 'full', snapshot: snapshotText },
    data,
    lines: [`snapshot · tab ${tab.tabId} · rev ${tab.rev} · ${observation.refs.length} refs`],
    pageText: snapshotText,
    notices: notices.filter(Boolean),
  };
}

function findNode(nodes: ONode[], frameId: string, backendNodeId: number): ONode | undefined {
  for (const n of nodes) {
    if (n.frameId === frameId && n.backendNodeId === backendNodeId) return n;
    const inner = findNode(n.children, frameId, backendNodeId);
    if (inner) return inner;
  }
  return undefined;
}

function actionableNodes(nodes: ONode[], out: ONode[] = []): ONode[] {
  for (const n of nodes) {
    if (n.ref) out.push(n);
    actionableNodes(n.children, out);
  }
  return out;
}

export async function find(ctx: ToolContext, args: FindArgs): Promise<ToolOutcome<FindMatch[]>> {
  if (!args.role && !args.name && !args.text) {
    throw new LayerError('INVALID_ARGUMENT', 'find needs at least one of role, name or text');
  }
  const tab = ctx.tab();
  const observation = await recentObservation(ctx);
  let roots = observation.tree;
  if (args.within) {
    const within = lookupRef(ctx.controller.registry, ctx.session.known, args.within, tab.tabId);
    const node = findNode(roots, within.frameId, within.backendNodeId);
    if (!node) throw new LayerError('NODE_DETACHED', `Ref ${args.within} is no longer in the page`);
    roots = node.children;
  }
  const role = args.role?.toLowerCase();
  const cleanQ = (s: string) =>
    cleanText(s)
      .replace(/\.{3}$|…$/, '')
      .trim()
      .toLowerCase();
  const name = args.name ? cleanQ(args.name) : undefined;
  const text = args.text ? cleanQ(args.text) : undefined;
  const matches = actionableNodes(roots).filter(n => {
    if (role && n.role.toLowerCase() !== role && n.rawRole.toLowerCase() !== role) {
      const isEditorMatch = role === 'textbox' && (n.name?.toLowerCase().includes('editor') || n.role === 'textbox');
      if (!isEditorMatch) return false;
    }
    const cleanNName = cleanQ(n.name ?? '');
    const cleanNVal = cleanQ(n.value ?? '');
    const matchName =
      !name ||
      cleanNName.includes(name) ||
      (name.length >= 4 && cleanNName.length >= 4 && (name.startsWith(cleanNName) || cleanNName.startsWith(name)));
    const matchText =
      !text ||
      cleanNName.includes(text) ||
      (text.length >= 4 && cleanNName.length >= 4 && (text.startsWith(cleanNName) || cleanNName.startsWith(text))) ||
      (!n.masked &&
        (cleanNVal.includes(text) ||
          (text.length >= 4 && cleanNVal.length >= 4 && (text.startsWith(cleanNVal) || cleanNVal.startsWith(text)))));
    return matchName && matchText;
  });
  const limit = args.limit ?? 20;
  const shown = matches.slice(0, limit);
  // The baseline is what this observation shows, even when it is a reused one.
  ctx.session.known.add(
    tab.tabId,
    shownOf(
      observation,
      shown.map(n => n.ref!),
    ),
  );
  const data = shown.map(n => ({ ref: n.ref!, line: renderLine(n), tabId: tab.tabId }));
  const notices =
    matches.length > limit ? [`… ${matches.length - limit} more matches; raise limit or narrow the query.`] : [];
  return {
    data,
    lines: [`find · tab ${tab.tabId} · ${matches.length} match${matches.length === 1 ? '' : 'es'}`],
    pageText: data.length ? data.map(d => d.line).join('\n') : undefined,
    notices,
  };
}

export async function read(
  ctx: ToolContext,
  args: ReadArgs,
): Promise<ToolOutcome<{ content: string; offset: number; remaining: number }>> {
  const tab = ctx.tab();
  const observation = await recentObservation(ctx);
  let roots = observation.tree;
  let customContent: string | null = null;
  if (args.ref) {
    const record = lookupRef(ctx.controller.registry, ctx.session.known, args.ref, tab.tabId);
    const node = findNode(roots, record.frameId, record.backendNodeId);
    if (!node) throw new LayerError('NODE_DETACHED', `Ref ${args.ref} is no longer in the page`);
    roots = [node];
    try {
      // 1. Try reading the full editor text from the main execution context via CDP (bypasses isolated world & DOM virtualization)
      const attachment = await ctx.attach().catch(() => null);
      if (attachment) {
        const frames = await attachment.topology.frames().catch(() => []);
        const frame = frames.find(f => f.frameId === record.frameId) ?? frames[0];
        if (frame) {
          const resolved = await attachment.cdp
            .send<{ object: { objectId?: string } }>(frame.sessionId, 'DOM.resolveNode', {
              backendNodeId: record.backendNodeId,
            })
            .catch(() => null);
          if (resolved?.object?.objectId) {
            const evalRes = await attachment.cdp
              .send<{ result?: { value?: string } }>(frame.sessionId, 'Runtime.callFunctionOn', {
                objectId: resolved.object.objectId,
                functionDeclaration: `function() {
                  try {
                    // Monaco: global, models, or editors
                    const monaco = window.monaco || (window.require && window.require('vs/editor/editor.main'));
                    if (monaco && monaco.editor) {
                      if (typeof monaco.editor.getEditors === 'function') {
                        const eds = monaco.editor.getEditors();
                        for (const ed of eds) {
                          const dom = ed.getDomNode?.() || ed.getContainerDomNode?.();
                          if (dom && (dom === this || this.contains(dom) || dom.contains(this))) {
                            const val = ed.getValue?.();
                            if (typeof val === 'string' && val.length > 0) return val;
                          }
                        }
                        if (eds.length > 0) {
                          const val = eds[0].getValue?.();
                          if (typeof val === 'string' && val.length > 0) return val;
                        }
                      }
                      if (typeof monaco.editor.getModels === 'function') {
                        const models = monaco.editor.getModels();
                        if (models.length > 0) {
                          const val = models[0].getValue?.();
                          if (typeof val === 'string' && val.length > 0) return val;
                        }
                      }
                    }
                  } catch (e) {}

                  // React Fiber: props or hooks
                  try {
                    const k = Object.keys(this).find(x => x.startsWith('__reactFiber') || x.startsWith('__reactInternalInstance'));
                    if (k) {
                      let curr = this[k];
                      let d = 0;
                      while (curr && d < 25) {
                        const p = curr.memoizedProps;
                        if (p) {
                          if (typeof p.value === 'string' && p.value.length > 0) return p.value;
                          if (typeof p.defaultValue === 'string' && p.defaultValue.length > 0) return p.defaultValue;
                          if (typeof p.initialValue === 'string' && p.initialValue.length > 0) return p.initialValue;
                          if (typeof p.code === 'string' && p.code.length > 0) return p.code;
                        }
                        let hook = curr.memoizedState;
                        while (hook) {
                          const inst = hook.memoizedState?.current || hook.baseState?.current || hook.memoizedState;
                          if (inst) {
                            if (typeof inst.getValue === 'function') {
                              const val = inst.getValue();
                              if (typeof val === 'string' && val.length > 0) return val;
                            }
                            if (typeof inst.getModel === 'function') {
                              const val = inst.getModel()?.getValue?.();
                              if (typeof val === 'string' && val.length > 0) return val;
                            }
                          }
                          hook = hook.next;
                        }
                        curr = curr.return;
                        d++;
                      }
                    }
                  } catch (e) {}

                  // Ace editor
                  try {
                    const ace = this.env?.editor || (this.closest('.ace_editor') || this.querySelector('.ace_editor'))?.env?.editor || (window.ace && window.ace.edit(this));
                    if (ace && typeof ace.getValue === 'function') {
                      const val = ace.getValue();
                      if (typeof val === 'string' && val.length > 0) return val;
                    }
                  } catch (e) {}

                  // CodeMirror 5
                  try {
                    const cm = this.CodeMirror || (this.closest('.CodeMirror') || this.querySelector('.CodeMirror'))?.CodeMirror;
                    if (cm && typeof cm.getValue === 'function') {
                      const val = cm.getValue();
                      if (typeof val === 'string' && val.length > 0) return val;
                    }
                  } catch (e) {}

                  // CodeMirror 6
                  try {
                    const cmView = this.cmView || (this.closest('.cm-editor') || this.querySelector('.cm-editor'))?.cmView;
                    if (cmView?.view?.state?.doc) {
                      const val = cmView.view.state.doc.toString();
                      if (typeof val === 'string' && val.length > 0) return val;
                    }
                  } catch (e) {}

                  return null;
                }`,
                returnByValue: true,
              })
              .catch(() => null);

            await attachment.cdp
              .send(frame.sessionId, 'Runtime.releaseObject', { objectId: resolved.object.objectId })
              .catch(() => null);

            if (
              evalRes?.result?.value &&
              typeof evalRes.result.value === 'string' &&
              evalRes.result.value.trim().length > 0
            ) {
              customContent = evalRes.result.value;
            }
          }

          // Global evaluate fallback in main world if callFunctionOn didn't locate the editor model
          if (!customContent) {
            const globalEval = await attachment.cdp
              .send<{ result?: { value?: string } }>(frame.sessionId, 'Runtime.evaluate', {
                expression: `(function() {
                  try {
                    const m = window.monaco || (window.require && window.require('vs/editor/editor.main'));
                    if (m && m.editor) {
                      const eds = m.editor.getEditors ? m.editor.getEditors() : [];
                      if (eds.length > 0 && typeof eds[0].getValue === 'function') {
                        const v = eds[0].getValue();
                        if (v && v.length > 0) return v;
                      }
                      const models = m.editor.getModels ? m.editor.getModels() : [];
                      if (models.length > 0 && typeof models[0].getValue === 'function') {
                        const v = models[0].getValue();
                        if (v && v.length > 0) return v;
                      }
                    }
                  } catch (e) {}
                  return null;
                })()`,
                returnByValue: true,
              })
              .catch(() => null);
            if (
              globalEval?.result?.value &&
              typeof globalEval.result.value === 'string' &&
              globalEval.result.value.trim().length > 0
            ) {
              customContent = globalEval.result.value;
            }
          }
        }
      }

      // 2. Fallback to probe state
      if (!customContent) {
        const target = await resolveTarget(ctx, { ref: args.ref }).catch(() => null);
        if (target && tab.probe) {
          const state = await tab.probe.call<ProbeState>(target.frame, target.objectId, 'state').catch(() => null);
          if (state?.value && state.value.trim().length > 0) {
            const isEditor = await tab.probe
              .call<boolean>(target.frame, target.objectId, 'isEditor')
              .catch(() => false);
            if (isEditor || state.value.length > 30 || state.value.includes('\n')) {
              customContent = state.value;
            }
          }
        }
      }
    } catch {
      // fallback to renderContent
    }
  }
  const content = customContent ?? renderContent(roots, args.format ?? 'markdown');
  const offset = args.offset ?? 0;
  const { text, remaining } = sliceContent(content, offset, args.maxChars ?? 20_000);
  const notices = remaining ? [`… ${remaining} more characters; continue with offset ${offset + text.length}.`] : [];
  return {
    data: { content: text, offset, remaining },
    lines: [`read · tab ${tab.tabId} · ${quote(observation.title)} · ${text.length} characters`],
    pageText: text,
    notices,
  };
}

export async function screenshot(ctx: ToolContext, args: ScreenshotArgs): Promise<ToolOutcome<ScreenshotData>> {
  const attachment = await ctx.attach();
  const tab = ctx.tab();
  const { cdp } = attachment;
  const frames = await attachment.topology.frames();
  const scroll = await scrollOffset(cdp, undefined);
  let clip: { x: number; y: number; width: number; height: number } | undefined;
  let origin = { x: scroll.x, y: scroll.y };
  if (args.ref) {
    const record = lookupRef(ctx.controller.registry, ctx.session.known, args.ref, tab.tabId);
    const frame = frames.find(f => f.frameId === record.frameId);
    if (!frame) throw new LayerError('FRAME_DETACHED', `The frame of ${args.ref} is gone`);
    const quad = await topLevelQuad(cdp, frames, frame, record.backendNodeId, root =>
      tab.probe!.callGlobal(root, 'viewport'),
    );
    if (!quad) throw new LayerError('NOT_VISIBLE', `${args.ref} has no box to capture`);
    const b = quadBounds(quad);
    // Page.captureScreenshot clips in document coordinates; quads are viewport coordinates.
    clip = { x: b.x + scroll.x, y: b.y + scroll.y, width: Math.max(1, b.width), height: Math.max(1, b.height) };
    origin = { x: clip.x, y: clip.y };
  } else if (args.fullPage) {
    origin = { x: 0, y: 0 };
  }
  // The outline says which field values are masked; the image hides the same ones.
  const observation = await recentObservation(ctx);
  const shot = await attachment.page.screenshot({ fullPage: !args.ref && args.fullPage, clip });
  // A clipped image is as wide as its clip. A viewport image is as wide as the viewport with its scrollbar, which
  // the layout viewport of Page.getLayoutMetrics leaves out, so that width is read in the page (the probe).
  let cssWidth = clip?.width;
  if (cssWidth === undefined) {
    cssWidth = args.fullPage
      ? (await cdp.send<{ cssContentSize: { width: number } }>(undefined, 'Page.getLayoutMetrics')).cssContentSize.width
      : (await tab.probe!.callGlobal<{ width: number }>(frames[0], 'viewport')).width;
  }
  const scale = shot.width / Math.max(1, cssWidth);
  let base64 = shot.base64;
  try {
    const hidden = [...hiddenNodes(observation.tree), ...observation.unplaced];
    base64 = await blankBoxes(base64, await boxesOf(ctx, hidden, frames, origin, true), scale);
  } catch (error) {
    // The next screenshot captures afresh rather than reuse an observation the page has moved on from.
    tab.last = undefined;
    throw new LayerError(
      'CAPTURE_FAILED',
      `The screenshot could not be returned with its sensitive values masked: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let labelled = 0;
  if (args.labels) {
    // Only what the image shows is presented: a ref outside a cropped image keeps the baseline it had.
    const image = clip ?? { width: shot.width / scale, height: shot.height / scale };
    const boxes = presentedBoxes(await boxesOf(ctx, observation.entries.slice(0, 300), frames, origin), image);
    labelled = boxes.length;
    base64 = await drawLabels(base64, boxes, scale);
    ctx.session.known.add(
      tab.tabId,
      shownOf(
        observation,
        boxes.map(b => b.ref),
      ),
    );
  }
  return {
    data: { mimeType: 'image/png', base64, width: shot.width, height: shot.height, scale, origin },
    lines: [
      `screenshot · tab ${tab.tabId} · ${shot.width}×${shot.height} px · scale ${scale.toFixed(2)}${args.labels ? ` · ${labelled} labels` : ''}`,
    ],
  };
}

/** Nodes a screenshot paints over: masked values and options, and frames whose content was not captured or placed. */
function hiddenNodes(roots: ONode[]): Array<{ frameId: string; backendNodeId: number }> {
  const out: Array<{ frameId: string; backendNodeId: number }> = [];
  const walk = (n: ONode) => {
    if ((n.masked || n.unseen) && n.backendNodeId !== undefined)
      out.push({ frameId: n.frameId, backendNodeId: n.backendNodeId });
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/**
 * The boxes of the given nodes in CSS pixels relative to the image's top-left. With `required` (the nodes a
 * screenshot paints over), a node without a box must still be in its document, where it is not shown; one that has
 * left it was re-rendered after the capture, and its replacement may show the value, so the image fails.
 */
async function boxesOf<T extends { frameId: string; backendNodeId: number; ref?: string }>(
  ctx: ToolContext,
  nodes: T[],
  frames: FrameRecord[],
  origin: { x: number; y: number },
  required = false,
): Promise<Array<{ ref: string; x: number; y: number; width: number; height: number }>> {
  const attachment = await ctx.attach();
  const scroll = await scrollOffset(attachment.cdp, undefined);
  const boxes = await Promise.all(
    nodes.map(async e => {
      const frame = frames.find(f => f.frameId === e.frameId);
      if (!frame) return null;
      const quad = await topLevelQuad(attachment.cdp, frames, frame, e.backendNodeId, root =>
        ctx.tab().probe!.callGlobal(root, 'viewport'),
      ).catch(() => null);
      if (!quad && required && !(await inDocument(ctx, frame, e.backendNodeId))) {
        throw new Error('a masked element left the page after the capture; take the screenshot again');
      }
      if (!quad) return null;
      const b = quadBounds(quad);
      return {
        ref: e.ref ?? '',
        x: b.x + scroll.x - origin.x,
        y: b.y + scroll.y - origin.y,
        width: b.width,
        height: b.height,
      };
    }),
  );
  return boxes.filter((b): b is NonNullable<typeof b> => b !== null && b.width > 0 && b.height > 0);
}

/** Whether a node is still in its frame's document (read in the probe's world, which the page cannot change). */
async function inDocument(ctx: ToolContext, frame: FrameRecord, backendNodeId: number): Promise<boolean> {
  const probe = ctx.tab().probe;
  if (!probe) return false;
  let objectId: string;
  try {
    objectId = await probe.resolve(frame, backendNodeId);
  } catch {
    return false;
  }
  try {
    const { result } = await (
      await ctx.attach()
    ).cdp.send<{ result: { value?: unknown } }>(frame.sessionId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function () { return this.isConnected; }',
      returnByValue: true,
    });
    return result.value === true;
  } catch {
    return false;
  } finally {
    await probe.release(frame, objectId);
  }
}
