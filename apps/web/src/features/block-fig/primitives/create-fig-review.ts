/**
 * Review and presentation around the editor: the comment tool, the
 * Prototype tab (its data and edits), and presenting, with their keys
 * (C, ⌥⌘↵, Escape leaving the comment tool).
 */

import type { FigEngine } from '@core/fig-engine/client';
import type { PrototypeInfo } from '@core/fig-engine/prototype-types';
import { createEffect, createSignal, on, onMount } from 'solid-js';
import type { PanelTab } from '../components/design-panel';
import type { FigViewerContext } from '../context/fig-viewer-context';
import {
  type ClickInteraction,
  flowsOf,
  presentStart,
  replaceInteraction,
} from '../core/prototype';
import type { KeyInput } from '../core/shortcuts';
import { createFigComments } from './create-fig-comments';
import type { FigEditor, Op } from './create-fig-editor';
import type { FigViewer } from './create-fig-viewer';

/** The review keys: C for comments, ⌥⌘↵ (Ctrl+Alt+Enter) to present. */
export function reviewKey(
  e: KeyInput,
  mac: boolean
): 'comment-tool' | 'present' | undefined {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mod && e.altKey && e.key === 'Enter') return 'present';
  if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey)
    return 'comment-tool';
  return undefined;
}

export function createFigReview(options: {
  context: FigViewerContext;
  engine: FigEngine;
  viewer: FigViewer;
  editor: FigEditor;
  mac: boolean;
}) {
  const { context, engine, viewer, editor } = options;
  const comments = context.comments
    ? createFigComments({ store: context.comments, engine, viewer })
    : undefined;

  const [panelTab, setPanelTab] = createSignal<PanelTab>('design');
  const [prototype, setPrototype] = createSignal<PrototypeInfo>();
  const [presenting, setPresenting] = createSignal<{
    info: PrototypeInfo;
    page: number;
    start: string;
  }>();

  let request = 0;
  const loadPrototype = async () => {
    const r = ++request;
    try {
      const info = await engine.prototype(viewer.page());
      if (r === request) setPrototype(info);
      return info;
    } catch {
      if (r === request) setPrototype(undefined);
      return undefined;
    }
  };
  // The Prototype tab reads the page's prototype from the engine (an
  // external system), again after every edit.
  createEffect(
    on([panelTab, viewer.page, viewer.editVersion], ([tab]) => {
      if (tab === 'prototype') void loadPrototype();
    })
  );

  /** The screen the selection is on (its top-level layer). */
  const selectedScreen = async () => {
    const id = viewer.selected()[0]?.id;
    if (!id) return undefined;
    try {
      const chain = await engine.ancestry(viewer.page(), id);
      return chain[0]?.id;
    } catch {
      return undefined;
    }
  };

  /** Presents from `frame`, else from the selection's screen or the flow. */
  const present = async (frame?: string) => {
    const info = await engine.prototype(viewer.page()).catch(() => undefined);
    if (!info) return;
    const start = frame ?? presentStart(info, await selectedScreen());
    if (!start) {
      context.notifyInfo('Add a frame to present');
      return;
    }
    comments?.setActive(false);
    setPresenting({ info, page: viewer.page(), start });
  };

  /** Opens the page holding `frame` and presents it (a frame link). */
  const presentFrame = async (frame: string) => {
    for (let p = 0; p < viewer.pages.length; p++) {
      const info = await engine.prototype(p).catch(() => undefined);
      if (!info?.frames.some((f) => f.id === frame)) continue;
      if (p !== viewer.page()) await viewer.openPage(p);
      setPresenting({ info, page: p, start: frame });
      return;
    }
    context.notifyError('That frame is no longer in this design');
  };

  onMount(() => {
    if (context.presentAt) void presentFrame(context.presentAt);
  });

  const copyFrameLink = async (frame: string) => {
    const link = context.frameLink?.(frame);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      context.notifyInfo('Link copied');
    } catch {
      context.notifyError('Could not copy the link');
    }
  };

  const toggleComments = () => {
    if (!comments) return;
    const on = !comments.active();
    comments.setActive(on);
    if (on) viewer.setTool('move');
  };

  /** Handles a review key; returns whether it was one. */
  const onKey = (e: KeyboardEvent): boolean => {
    if (presenting()) return true;
    if (comments?.active() && e.key === 'Escape') {
      if (comments.draft() || comments.openThread()) {
        comments.cancelDraft();
        comments.setOpenThread(undefined);
      } else comments.setActive(false);
      e.preventDefault();
      return true;
    }
    const action = reviewKey(e, options.mac);
    if (!action || (action === 'comment-tool' && !comments)) return false;
    e.preventDefault();
    e.stopPropagation();
    if (action === 'present') void present();
    else toggleComments();
    return true;
  };

  /** Puts `edited` in place of interaction `index` of layer `id`. */
  const setInteraction = async (
    id: string,
    index: number,
    edited: ClickInteraction | null
  ) => {
    const info = prototype() ?? (await loadPrototype());
    if (!info) return;
    const existing = info.hotspots.find((h) => h.id === id)?.interactions ?? [];
    const ops: Op[] = [
      {
        op: 'setInteractions',
        id,
        interactions: replaceInteraction(existing, index, edited),
      },
    ];
    // Figma starts a flow at the screen a page's first connection leaves.
    if (edited && flowsOf(info).length === 0) {
      const chain = await engine.ancestry(viewer.page(), id).catch(() => []);
      const screen = chain[0]?.id;
      if (screen && info.frames.some((f) => f.id === screen))
        ops.push({ op: 'setFlowStart', id: screen, name: 'Flow 1' });
    }
    await editor.apply(ops);
  };

  const setFlowStart = (frame: string, name: string | null) =>
    void editor.apply([{ op: 'setFlowStart', id: frame, name }]);

  return {
    comments,
    panelTab,
    setPanelTab,
    prototype,
    presenting,
    stopPresenting: () => setPresenting(undefined),
    present,
    copyFrameLink: context.frameLink ? copyFrameLink : undefined,
    toggleComments,
    onKey,
    setInteraction,
    setFlowStart,
  };
}

export type FigReview = ReturnType<typeof createFigReview>;
