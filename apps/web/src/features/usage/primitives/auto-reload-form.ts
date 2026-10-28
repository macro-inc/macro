import { createSignal } from 'solid-js';
import {
  type AutoReloadSettings,
  parseDollarInput,
  validateAutoReload,
} from '../core/usage';

export function createAutoReloadForm(initial: AutoReloadSettings) {
  const [minimum, setMinimum] = createSignal(
    String(initial.minimumBalanceCents / 100)
  );
  const [target, setTarget] = createSignal(
    String(initial.targetBalanceCents / 100)
  );
  const [maximum, setMaximum] = createSignal(
    initial.monthlySpendLimitCents === null
      ? ''
      : String(initial.monthlySpendLimitCents / 100)
  );
  const settings = (): AutoReloadSettings | undefined => {
    const minimumBalanceCents = parseDollarInput(minimum());
    const targetBalanceCents = parseDollarInput(target());
    const monthlySpendLimitCents = maximum().trim()
      ? parseDollarInput(maximum())
      : null;
    if (
      minimumBalanceCents === undefined ||
      targetBalanceCents === undefined ||
      monthlySpendLimitCents === undefined
    )
      return;
    return {
      enabled: true,
      minimumBalanceCents,
      targetBalanceCents,
      monthlySpendLimitCents,
    };
  };
  const error = () => {
    const value = settings();
    return value
      ? validateAutoReload(value)
      : 'Enter dollar amounts greater than $0, using at most two decimal places.';
  };
  return {
    minimum,
    setMinimum,
    target,
    setTarget,
    maximum,
    setMaximum,
    settings,
    error,
  };
}
