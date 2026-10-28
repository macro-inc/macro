import { createSignal } from 'solid-js';
import {
  type IPlaceable,
  PayloadMode,
  type PayloadType,
} from '../type/placeables';

type PlacementMode = Exclude<PayloadType, typeof PayloadMode.NoMode>;

export function createPdfMarkup() {
  const [mode, setMode] = createSignal<PayloadType>(PayloadMode.NoMode);
  const [activeId, setActiveId] = createSignal<string>();
  const [draft, setDraft] = createSignal<IPlaceable>();
  const [dragActive, setDragActive] = createSignal(false);

  const commands = {
    beginPlacement(nextMode: PlacementMode) {
      setMode(nextMode);
    },
    cancelPlacement() {
      setMode(PayloadMode.NoMode);
    },
    activate(id: string) {
      setActiveId(id);
    },
    clearActive() {
      setActiveId(undefined);
    },
    clearActiveIf(id: string) {
      setActiveId((activeId) => (activeId === id ? undefined : activeId));
    },
    setDraft(placeable: IPlaceable) {
      setDraft(placeable);
    },
    clearDraft() {
      setDraft(undefined);
    },
    clearDraftIf(id: string) {
      setDraft((draft) => (draft?.internalId === id ? undefined : draft));
    },
    setDragActive(active: boolean) {
      setDragActive(active);
    },
  };

  return {
    mode,
    activeId,
    draft,
    dragActive,
    commands,
  };
}

export type PdfMarkup = ReturnType<typeof createPdfMarkup>;
