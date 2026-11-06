import { createSignal, onCleanup, onMount } from 'solid-js';
import type { SharingSource } from '../context/contracts';
import { type AccessLevel, requestLevels } from '../core/types';

/** Request choices and cooldown state, independent of the real query adapter. */
export function createRequestComposer(
  source: SharingSource,
  allowed: () => readonly AccessLevel[]
) {
  const [selected, setSelected] = createSignal<AccessLevel>();
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    onCleanup(() => clearInterval(timer));
  });
  const levels = () =>
    requestLevels(source.state()).filter((level) => allowed().includes(level));
  const pending = () => source.state()?.mine?.status === 'pending';
  const level = () => {
    const choices = levels();
    const desired =
      selected() ??
      (pending() ? source.state()?.mine?.requestedLevel : undefined) ??
      (source.state()?.accessLevel == null ? 'view' : undefined);
    return desired && choices.some((choice) => choice === desired)
      ? desired
      : (choices.at(-1) ?? 'comment');
  };
  const retryAfter = () => source.state()?.mine?.retryAfter;
  const coolingDown = () =>
    !!retryAfter() && new Date(retryAfter()!).getTime() > now();
  const unchanged = () =>
    pending() && level() === source.state()?.mine?.requestedLevel;
  return {
    levels,
    pending,
    level,
    setSelected,
    retryAfter,
    coolingDown,
    unchanged,
    visible: () =>
      !source.state()?.canReview && (levels().length > 0 || pending()),
    send: () => source.submit(level(), source.state()?.mine?.revision),
    cancel: async () => {
      const request = source.state()?.mine;
      if (request) await source.cancel(request.revision);
    },
  };
}
