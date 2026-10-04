/**
 * Slide Master view (View ▸ Slide Master): entering and closing it, and the
 * Slide Master tab's actions on the master or layout being edited. Shapes,
 * text, and backgrounds of masters and layouts are edited by the ordinary
 * slide editor, through an engine whose slide indexes address them.
 */

import type { PlaceholderKind } from '@core/pptx-engine/types';
import { createSignal } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  deleteBlocker,
  findMasterPage,
  layoutOptions,
  type MasterPage,
  placeholderBox,
} from '../core/master-view';
import type { PresentationSession } from './create-presentation-session';
import type { SlideEditor } from './create-slide-editor';

/**
 * `engine` with slide indexes mapped through `pages` (the ids of the pages
 * shown, when they are not the slides): the engine reads a master or
 * layout by its id where it reads a slide by its index.
 */
export function pageAddressedEngine(
  engine: PresentationEngine,
  pages: () => number[] | undefined
): PresentationEngine {
  const at = (index: number) => {
    const ids = pages();
    return ids ? (ids[index] ?? -1) : index;
  };
  return {
    ...engine,
    slideOutline: (index) => engine.slideOutline(at(index)),
    render: (index, width) => engine.render(at(index), width),
    renderLayer: (index, width, mode, shape) =>
      engine.renderLayer(at(index), width, mode, shape),
    textLayout: (index, shape, cell) =>
      engine.textLayout(at(index), shape, cell),
    copyShapes: (index, shapes) => engine.copyShapes(at(index), shapes),
  };
}

export interface MasterViewOptions {
  session: PresentationSession;
  editor: SlideEditor;
  /** Slide size in points. */
  slideSize: () => { w: number; h: number };
  notifyError: (message: string) => void;
}

export function createMasterView(options: MasterViewOptions) {
  const { session, editor } = options;
  const active = () => session.view() === 'master';
  /** The master or layout being edited. */
  const page = (): MasterPage | undefined => {
    const deck = session.deck();
    const current = session.currentSlide();
    return active() && deck && current
      ? findMasterPage(deck, current.id)
      : undefined;
  };
  const pageOf = (id: number) => {
    const deck = session.deck();
    return deck ? findMasterPage(deck, id) : undefined;
  };
  /** The page whose Rename dialog is open. */
  const [renaming, setRenaming] = createSignal<MasterPage>();
  /** Inserted placeholders so far, to offset each new one. */
  let inserted = 0;

  const goTo = (id: number) => {
    const at = session.outline()?.slides.findIndex((s) => s.id === id) ?? -1;
    if (at >= 0) editor.goToSlide(at);
  };

  async function enter() {
    editor.stopEditing();
    editor.setSelection([]);
    await session.enterMasterView();
  }

  async function close() {
    editor.stopEditing();
    editor.setSelection([]);
    await session.exitMasterView();
  }

  /** Slide Master ▸ Insert Layout, after `after` (default: the page edited). */
  async function insertLayout(after = page()) {
    const result = await session.apply([
      after
        ? { op: 'addLayout', after: after.id }
        : { op: 'addLayout', master: session.deck()?.masters?.[0]?.id },
    ]);
    const id = result?.created[0]?.slide;
    if (id !== undefined) goTo(id);
  }

  /** Duplicate Layout: a copy right after the layout. */
  async function duplicateLayout(target = page()) {
    if (!target?.layout) return;
    const result = await session.apply([
      { op: 'addLayout', duplicate: target.id },
    ]);
    const id = result?.created[0]?.slide;
    if (id !== undefined) goTo(id);
  }

  /** Delete Layout (or Delete Master), when nothing uses it. */
  async function deletePage(target = page()) {
    const deck = session.deck();
    if (!target || !deck) return;
    const blocker = deleteBlocker(deck, target);
    if (blocker) {
      options.notifyError(`${blocker}, so it cannot be deleted.`);
      return;
    }
    editor.stopEditing();
    editor.setSelection([]);
    await session.apply([{ op: 'deleteLayout', layout: target.id }]);
  }

  async function rename(target: MasterPage, name: string) {
    const trimmed = name.trim();
    const current = target.layout?.name ?? target.master.name;
    if (!trimmed || trimmed === current) return;
    await session.apply([
      { op: 'renameLayout', layout: target.id, name: trimmed },
    ]);
  }

  /** Slide Master ▸ Insert Placeholder: a placeholder in the middle of the layout, selected. */
  async function insertPlaceholder(kind: PlaceholderKind, vertical = false) {
    const target = page();
    if (!target?.layout) return;
    const box = placeholderBox(options.slideSize(), vertical, inserted++);
    editor.stopEditing();
    const result = await session.apply([
      { op: 'insertPlaceholder', layout: target.id, kind, vertical, ...box },
    ]);
    const shape = result?.created[0]?.shape;
    if (shape !== undefined) editor.select(shape);
  }

  /** The layout's Title, Footers, and Hide Background Graphics checkboxes. */
  async function setOptions(patch: {
    title?: boolean;
    footers?: boolean;
    hideBackgroundGraphics?: boolean;
  }) {
    const target = page();
    if (!target?.layout) return;
    editor.stopEditing();
    editor.setSelection([]);
    await session.apply([
      { op: 'setLayoutOptions', layout: target.id, ...patch },
    ]);
  }

  /** Background Styles: style 1-12 of the theme on the page edited. */
  async function setBackgroundStyle(style: number) {
    const target = page();
    if (!target) return;
    await session.apply([
      { op: 'setBackgroundStyle', slide: target.id, style },
    ]);
  }

  return {
    active,
    page,
    pageOf,
    goTo,
    enter,
    close,
    insertLayout,
    duplicateLayout,
    deletePage,
    renaming,
    startRename: (target = page()) => setRenaming(target),
    stopRename: () => setRenaming(undefined),
    rename,
    insertPlaceholder,
    setOptions,
    setBackgroundStyle,
    /** Title and Footers checkbox states of the layout edited. */
    options: () => layoutOptions(session.currentSlide()),
    /** Why the page edited cannot be deleted (`undefined`: it can). */
    deleteBlocker: () => {
      const deck = session.deck();
      const target = page();
      return deck && target ? deleteBlocker(deck, target) : undefined;
    },
  };
}

export type MasterView = ReturnType<typeof createMasterView>;
