import { type Accessor, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  fieldsFor,
  inDocumentOrder,
  isAutoFilled,
  isMark,
} from '../core/fields';
import type { Adoption, SigningInput } from '../core/lifecycle';
import type { Packet, PacketField, Recipient } from '../core/packet';

/**
 * A signer's progress through their fields before they finish: the mark they
 * adopted, the values they entered, and what is still required of them.
 */
export function createSigningProgress(
  packet: Accessor<Packet>,
  recipient: Accessor<Recipient>
) {
  const [adoption, setAdoption] = createSignal<Adoption>();
  const [values, setValues] = createStore<Record<string, string | boolean>>({});

  const mine = () =>
    inDocumentOrder(packet(), fieldsFor(packet(), recipient().id));

  const isDone = (field: PacketField): boolean => {
    if (isAutoFilled(field.kind)) return true;
    if (isMark(field.kind)) return adoption() !== undefined;

    const value = values[field.id];
    if (field.kind === 'checkbox') return value === true;
    return typeof value === 'string' && value.trim() !== '';
  };

  /** Fields the signer must complete themselves before they can finish. */
  const required = () =>
    mine().filter((field) => field.required && !isAutoFilled(field.kind));
  const remaining = () => required().filter((field) => !isDone(field));

  return {
    fields: mine,
    adoption,
    adopt: setAdoption,
    value: (fieldId: string) => values[fieldId],
    setValue: (fieldId: string, value: string | boolean) =>
      setValues(fieldId, value),

    /** Progress counts what is required; optional fields never hold it back. */
    doneCount: () => required().filter(isDone).length,
    totalCount: () => required().length,
    remaining,
    /** The next required field to complete, in document order. */
    next: () => remaining()[0],
    canFinish: () => remaining().length === 0 && adoption() !== undefined,

    /** What to submit, once the signer may finish. */
    input(): SigningInput | undefined {
      const adopted = adoption();
      if (!adopted) return undefined;
      return { ...adopted, values: { ...values } };
    },
  };
}
