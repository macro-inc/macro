import { createStore, unwrap } from 'solid-js/store';
import {
  boxAtPoint,
  clampBox,
  placementProblems,
  resizeBox,
} from '../core/fields';
import type { FieldBox, FieldKind, Packet, PacketField } from '../core/packet';
import { signers } from '../core/packet';

type PlacementState = {
  fields: PacketField[];
  selectedId: string | undefined;
  /** The signer new fields are placed for. */
  recipientId: string;
};

/** Arrow keys move a selected field by this fraction of the page. */
const NUDGE_PCT = 0.005;

/**
 * Field placement for one draft packet: which fields exist, which is
 * selected, and who new fields belong to. The caller saves `fields()`.
 */
export function createPlacement(options: {
  packet: Pick<Packet, 'documents' | 'recipients' | 'fields'>;
  newId: () => string;
}) {
  const [state, setState] = createStore<PlacementState>({
    fields: options.packet.fields.map((field) => ({ ...field })),
    selectedId: undefined,
    recipientId: signers(options.packet)[0]?.id ?? '',
  });

  const update = (fieldId: string, patch: Partial<PacketField>) =>
    setState('fields', (field) => field.id === fieldId, patch);

  return {
    fields: () => state.fields,
    /** A plain copy of the fields as they are now, to save. */
    snapshot: (): PacketField[] => structuredClone(unwrap(state.fields)),
    selected: () => state.fields.find((field) => field.id === state.selectedId),
    recipientId: () => state.recipientId,
    problems: () =>
      placementProblems({ ...options.packet, fields: state.fields }),

    select: (fieldId: string | undefined) => setState('selectedId', fieldId),

    /** Place for a signer, and hand them the selected field if there is one. */
    chooseRecipient(recipientId: string) {
      setState('recipientId', recipientId);
    },

    /** Drop a new field centered on a point of a page, and select it. */
    add(
      kind: FieldKind,
      documentId: string,
      page: number,
      point: { xPct: number; yPct: number }
    ) {
      const field: PacketField = {
        id: options.newId(),
        documentId,
        page,
        recipientId: state.recipientId,
        kind,
        required: kind !== 'checkbox',
        box: boxAtPoint(kind, point),
      };
      setState('fields', (fields) => [...fields, field]);
      setState('selectedId', field.id);
    },

    /** Move a field, keeping all of it on the page. */
    move: (fieldId: string, box: FieldBox) =>
      update(fieldId, { box: clampBox(box) }),
    /** Resize a field from its corner; it stops growing at the page edge. */
    resize: (fieldId: string, box: FieldBox) =>
      update(fieldId, { box: resizeBox(box) }),

    nudge(fieldId: string, direction: { x: number; y: number }) {
      const field = state.fields.find((each) => each.id === fieldId);
      if (!field) return;
      update(fieldId, {
        box: clampBox({
          ...field.box,
          xPct: field.box.xPct + direction.x * NUDGE_PCT,
          yPct: field.box.yPct + direction.y * NUDGE_PCT,
        }),
      });
    },

    /** Grow or shrink a field by one step, for resizing from the keyboard. */
    grow(fieldId: string, direction: { x: number; y: number }) {
      const field = state.fields.find((each) => each.id === fieldId);
      if (!field) return;
      update(fieldId, {
        box: resizeBox({
          ...field.box,
          widthPct: field.box.widthPct + direction.x * NUDGE_PCT,
          heightPct: field.box.heightPct + direction.y * NUDGE_PCT,
        }),
      });
    },

    assign: (fieldId: string, recipientId: string) =>
      update(fieldId, { recipientId }),
    setRequired: (fieldId: string, required: boolean) =>
      update(fieldId, { required }),

    duplicate(fieldId: string) {
      const field = state.fields.find((each) => each.id === fieldId);
      if (!field) return;
      // The copy goes just below its source, or just above when the page
      // ends first, so it never lands on top of the field it came from.
      const gap = field.box.heightPct + NUDGE_PCT * 2;
      const fitsBelow = field.box.yPct + gap + field.box.heightPct <= 1;
      const copy: PacketField = {
        ...field,
        id: options.newId(),
        box: clampBox({
          ...field.box,
          yPct: field.box.yPct + (fitsBelow ? gap : -gap),
        }),
      };
      setState('fields', (fields) => [...fields, copy]);
      setState('selectedId', copy.id);
    },

    remove(fieldId: string) {
      setState('fields', (fields) =>
        fields.filter((field) => field.id !== fieldId)
      );
      if (state.selectedId === fieldId) setState('selectedId', undefined);
    },
  };
}
