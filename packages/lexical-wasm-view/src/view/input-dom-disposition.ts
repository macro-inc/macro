import type { IViewEffectMsg } from '@macro-inc/collaboration/session/abi.generated';

/** Actual native host calls; grants no model, handling or semantic authority. */
export interface InputDomDisposition {
  readonly defaultPrevented: boolean;
  readonly propagationStopped: boolean;
}

/** Strict transport decoding; unknown or noncanonical values fail loudly. */
export function inputDomDisposition(effects: readonly IViewEffectMsg[]): {
  readonly disposition: InputDomDisposition;
  readonly effects: IViewEffectMsg[];
  readonly present: boolean;
} {
  let defaultPrevented = false;
  let propagationStopped = false;
  let present = false;
  const remaining: IViewEffectMsg[] = [];
  for (const effect of effects) {
    if (effect.kind !== 6 || effect.code !== 12) {
      remaining.push(effect);
      continue;
    }
    const selection = effect.selection;
    const emptyPoint = (point: typeof selection.anchor) =>
      point.key === 0 && point.offset === 0 && point.type === 0;
    if (
      present ||
      (effect.detail !== 0 && effect.detail !== 1) ||
      typeof effect.flag !== 'boolean' ||
      effect.request !== 0 ||
      effect.text !== '' ||
      effect.format !== 0 ||
      effect.style !== '' ||
      effect.keys.length !== 0 ||
      effect.values.length !== 0 ||
      effect.events.length !== 0 ||
      effect.paths.length !== 0 ||
      effect.closedReason !== 0 ||
      effect.saveReason !== 0 ||
      selection.kind !== 0 ||
      selection.table !== 0 ||
      selection.dirty !== false ||
      selection.nodes.length !== 0 ||
      !emptyPoint(selection.anchor) ||
      !emptyPoint(selection.focus)
    ) {
      throw new Error('Invalid input DOM disposition');
    }
    present = true;
    defaultPrevented = effect.flag;
    propagationStopped = effect.detail === 1;
  }
  return {
    disposition: { defaultPrevented, propagationStopped },
    effects: remaining,
    present,
  };
}
