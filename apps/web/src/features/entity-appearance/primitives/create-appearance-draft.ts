import type { Result } from 'neverthrow';
import { createSignal, onCleanup } from 'solid-js';
import {
  defaultAppearance,
  type EntityAppearance,
  sameAppearance,
} from '../core/appearance';

export function createAppearanceDraft(options: {
  initial?: EntityAppearance | null;
  isCurrent: () => boolean;
  save: (appearance: EntityAppearance) => Promise<Result<void, string>>;
  onSaved: () => void;
}) {
  const initial = options.initial ?? defaultAppearance();
  const [appearance, setAppearance] = createSignal<EntityAppearance>(initial);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let active = true;
  onCleanup(() => {
    active = false;
  });
  const change = (value: EntityAppearance) => {
    if (!saving()) {
      setAppearance(value);
      setError(undefined);
    }
  };
  const changed = () => !sameAppearance(initial, appearance());
  async function apply() {
    if (saving() || !changed() || !options.isCurrent()) return;
    setSaving(true);
    setError(undefined);
    const result = await options.save(appearance());
    if (!active || !options.isCurrent()) return;
    setSaving(false);
    if (result.isErr()) {
      setError(result.error);
      return;
    }
    options.onSaved();
  }
  return { appearance, change, changed, saving, error, apply };
}
