/**
 * The view state of deck setup: which dialog is open (Header & Footer, Slide
 * Size, the Maximize / Ensure Fit question) and how sections show in the
 * rail and sorter (collapsed sections, the header being renamed, a header
 * being dragged). Edits go through the editor's commands.
 */

import type { SlideScale } from '@core/pptx-engine/types';
import { createMemo, createSignal } from 'solid-js';
import {
  type HeaderFooterForm,
  headerFooterPatch,
} from '../core/header-footer';
import {
  hiddenSlides,
  isSectionSelected,
  moveTarget,
  sectionOf,
  sectionRows,
} from '../core/sections';
import { sizeChange } from '../core/slide-size';
import type { EditorCommands } from './create-editor-commands';
import type { PresentationSession } from './create-presentation-session';

export function createDeckSetup(options: {
  session: PresentationSession;
  commands: EditorCommands;
  canEdit: () => boolean;
  /** Ids of the selected slides, in deck order. */
  selectedSlideIds: () => number[];
  /** Selects these slides; the first becomes the current slide. */
  selectSlides: (ids: number[]) => void;
}) {
  const { session, commands, canEdit } = options;

  // ---- dialogs ---------------------------------------------------------------

  const [headerFooterOpen, setHeaderFooterOpen] = createSignal(false);
  /** Apply (the selected slides) or Apply to All. */
  const applyHeaderFooter = (form: HeaderFooterForm, all: boolean) =>
    void commands.setHeaderFooter(
      headerFooterPatch(form, all ? undefined : options.selectedSlideIds())
    );
  const [slideSizeOpen, setSlideSizeOpen] = createSignal(false);
  /** A new size waiting for Maximize or Ensure Fit. */
  const [pendingSize, setPendingSize] = createSignal<{
    width: number;
    height: number;
  } | null>(null);

  /**
   * Changes the slide size: content scales right away when it keeps its
   * shape; otherwise PowerPoint's question decides how.
   */
  const requestSize = (width: number, height: number) => {
    const deck = session.outline();
    if (!deck || !canEdit()) return;
    const change = sizeChange(deck, { width, height });
    if (change === 'same') return;
    if (change === 'proportional') {
      void commands.setSlideSize(width, height, 'fit');
      return;
    }
    setPendingSize({ width, height });
  };
  /** Answers the question (`null` cancels). */
  const chooseScale = (scale: SlideScale | null) => {
    const size = pendingSize();
    setPendingSize(null);
    if (size && scale)
      void commands.setSlideSize(size.width, size.height, scale);
  };

  // ---- sections ----------------------------------------------------------------

  const sections = () => session.outline()?.sections;
  const rows = createMemo(() =>
    sectionRows(
      sections(),
      (session.outline()?.slides ?? []).map((s) => s.id)
    )
  );
  /** Ids of the sections whose headers go before slide `index` (stable keys). */
  const headersBefore = (index: number) =>
    rows()
      .filter((r) => r.before === index)
      .map((r) => r.section.id);
  const row = (id: string) => rows().find((r) => r.section.id === id);

  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(
    new Set()
  );
  const hidden = createMemo(() => hiddenSlides(sections(), collapsed()));
  const isCollapsed = (id: string) => collapsed().has(id);
  const toggleCollapsed = (id: string) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const collapseAll = () =>
    setCollapsed(new Set((sections() ?? []).map((s) => s.id)));
  const expandAll = () => setCollapsed(new Set<string>());

  const [renaming, setRenaming] = createSignal<string | null>(null);
  const startRename = (id: string | undefined) => {
    if (id && canEdit()) setRenaming(id);
  };
  /** Ends renaming; a changed, non-empty `name` renames the section. */
  const finishRename = (id: string, name: string | null) => {
    if (renaming() === id) setRenaming(null);
    const trimmed = name?.trim();
    if (trimmed && trimmed !== row(id)?.section.name)
      void commands.renameSection(id, trimmed);
  };

  /** The current slide's section. */
  const current = () => sectionOf(sections(), session.currentSlide()?.id);

  /** Adds a section before a slide (the current one) and starts naming it. */
  const add = async (beforeSlide = session.currentSlide()?.id) => {
    if (beforeSlide === undefined || !canEdit()) return;
    const id = await commands.addSection(beforeSlide);
    if (id) setRenaming(id);
  };
  const remove = (id: string, withSlides = false) =>
    void commands.removeSection(id, withSlides);
  /** Whether Remove Section & Slides would leave the deck without slides. */
  const holdsEverySlide = (id: string) =>
    (row(id)?.section.slideIds.length ?? 0) >=
    (session.outline()?.slides.length ?? 0);
  const canMove = (id: string, delta: -1 | 1) =>
    moveTarget(sections(), id, delta) !== undefined;
  const move = (id: string, delta: -1 | 1) => {
    const to = moveTarget(sections(), id, delta);
    if (to !== undefined) void commands.moveSection(id, to);
  };
  const moveTo = (id: string, index: number) => {
    if (row(id)?.index !== index) void commands.moveSection(id, index);
  };
  const removeAll = () => void commands.removeAllSections();

  /** Clicking a header selects the section's slides. */
  const select = (id: string) => {
    const ids = row(id)?.section.slideIds ?? [];
    if (ids.length > 0) options.selectSlides(ids);
  };
  const isSelected = (id: string) => {
    const section = row(id)?.section;
    return !!section && isSectionSelected(section, options.selectedSlideIds());
  };

  /** The section whose header is being dragged. */
  const [dragging, setDragging] = createSignal<string | null>(null);

  return {
    headerFooterOpen,
    setHeaderFooterOpen,
    applyHeaderFooter,
    slideSizeOpen,
    setSlideSizeOpen,
    pendingSize,
    requestSize,
    chooseScale,
    sections: {
      list: () => sections() ?? [],
      headersBefore,
      row,
      hidden: (slideId: number) => hidden().has(slideId),
      isCollapsed,
      toggleCollapsed,
      collapseAll,
      expandAll,
      renaming,
      startRename,
      finishRename,
      current,
      add,
      remove,
      holdsEverySlide,
      canMove,
      move,
      moveTo,
      removeAll,
      select,
      isSelected,
      dragging,
      setDragging,
    },
  };
}

export type DeckSetup = ReturnType<typeof createDeckSetup>;
