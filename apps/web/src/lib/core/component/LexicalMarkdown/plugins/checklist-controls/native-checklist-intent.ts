import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import {
  SessionPort,
  selectionMessage,
} from '@macro-inc/lexical-wasm-view/view/session-port';
import type { NormalizedSettings } from './model';

/** The sequence is a stale-view comparison, never access or transfer authority. */
export function dispatchNativeChecklistSettings(
  view: EditorView,
  key: number,
  observedSequence: string,
  settings: NormalizedSettings,
  validateTarget: () => void
): Promise<InputSettlement> {
  if (!(view.port instanceof SessionPort))
    throw new Error('Checklist settings require the native session port');
  const generation = view.mirror.keyGeneration;
  if (!view.isMounted || generation === null)
    throw new Error('Checklist settings view is unavailable');
  validateTarget();
  // Seal the same UI turn's owned settings and sequence, before queued admission.
  const json = JSON.stringify({ key, observedSequence, settings });
  if (!view.isMounted || view.mirror.keyGeneration !== generation)
    throw new Error('Checklist settings view changed during serialization');
  validateTarget();
  return view.port.inputSettled(() => {
    if (!view.isMounted || view.mirror.keyGeneration !== generation)
      throw new Error('Checklist settings view changed before admission');
    validateTarget();
    if (!view.isMounted || view.mirror.keyGeneration !== generation)
      throw new Error('Checklist settings view retired during admission');
    return {
      name: 'group-b.checklist-settings-intent',
      json,
      generation,
      selection: selectionMessage({ kind: 'keep' }),
    };
  });
}
