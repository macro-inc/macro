/**
 * Deck setup commands: Header & Footer, slide size, and sections. Each is one
 * batch (one undo step). Part of the editor's commands.
 */

import type {
  DeckOutline,
  EditOp,
  EditResult,
  HeaderFooterPatch,
  SlideScale,
} from '@core/pptx-engine/types';
import { NEW_SECTION_NAME } from '../core/sections';

export function createDeckCommands(options: {
  apply: (ops: EditOp[]) => Promise<EditResult | null>;
  outline: () => DeckOutline | undefined;
}) {
  const { apply } = options;

  /** Shows or hides the slide number, date, and footer (all slides without `slides`). */
  const setHeaderFooter = (patch: HeaderFooterPatch) =>
    apply([{ op: 'setHeaderFooter', ...patch }]);

  /** Changes the slide size (points); `scale` says how content follows. */
  const setSlideSize = (width: number, height: number, scale: SlideScale) =>
    apply([{ op: 'setSlideSize', width, height, scale }]);

  /** Starts a section at a slide; resolves with the new section's id. */
  const addSection = async (beforeSlide: number, name = NEW_SECTION_NAME) => {
    const result = await apply([{ op: 'addSection', name, beforeSlide }]);
    return result?.created.find((c) => c.section)?.section;
  };

  const renameSection = (id: string, name: string) =>
    apply([{ op: 'renameSection', id, name }]);

  /** Removes a section; its slides join a neighbor, or go with `deleteSlides`. */
  const removeSection = (id: string, deleteSlides = false) =>
    apply([
      { op: 'removeSection', id, ...(deleteSlides ? { deleteSlides } : {}) },
    ]);

  const moveSection = (id: string, toIndex: number) =>
    apply([{ op: 'moveSection', id, toIndex }]);

  /** Removes every section, keeping the slides. */
  const removeAllSections = () =>
    apply(
      (options.outline()?.sections ?? []).map((s) => ({
        op: 'removeSection' as const,
        id: s.id,
      }))
    );

  return {
    setHeaderFooter,
    setSlideSize,
    addSection,
    renameSection,
    removeSection,
    moveSection,
    removeAllSections,
  };
}

export type DeckCommands = ReturnType<typeof createDeckCommands>;
