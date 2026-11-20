import type { Result } from 'neverthrow';
import { createSignal, onCleanup } from 'solid-js';
import {
  defaultAppearance,
  type EntityAppearance,
  sameAppearance,
} from '../core/appearance';

/** Submit each pick to the existing optimistic, per-entity serialized save path. */
export function createAppearanceEditor(options: {
  initial?: EntityAppearance | null;
  isCurrent: () => boolean;
  save: (appearance: EntityAppearance) => Promise<Result<void, string>>;
}) {
  let confirmed = {
    revision: 0,
    appearance: options.initial ?? defaultAppearance(),
  };
  const pending = new Map<number, EntityAppearance>();
  const [appearance, setAppearance] = createSignal(confirmed.appearance);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let revision = 0;
  let active = true;
  onCleanup(() => {
    active = false;
  });

  async function change(value: EntityAppearance) {
    if (!active || !options.isCurrent() || sameAppearance(value, appearance()))
      return;
    const current = ++revision;
    pending.set(current, value);
    setAppearance(value);
    setSaving(true);
    setError(undefined);
    const result = await options.save(value);
    if (!active || !options.isCurrent()) return;
    pending.delete(current);
    if (result.isOk() && current > confirmed.revision) {
      confirmed = { revision: current, appearance: value };
    }
    if (result.isErr() && current === revision) setError(result.error);
    let visible = confirmed;
    for (const [revision, appearance] of pending) {
      if (revision > visible.revision) visible = { revision, appearance };
    }
    setAppearance(visible.appearance);
    setSaving(pending.size > 0);
  }

  return { appearance, change, saving, error };
}
