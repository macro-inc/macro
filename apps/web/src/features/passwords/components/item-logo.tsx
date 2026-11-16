import { fireAndForget } from '@core/util/fireAndForget';
import { cn } from '@ui';
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { PasswordKind } from '../core/types';
import { KIND_ICONS } from './kind-icon';

/** Server-fetched site logo, else the name's initial, else the kind's glyph. */
export function ItemLogo(props: {
  name: string;
  kind: PasswordKind;
  url: string | null;
  large?: boolean;
  loadLogo: (domain: string) => Promise<string | undefined>;
}) {
  const [logo, setLogo] = createSignal<string>();
  let generation = 0;
  async function load(url: string | null, expected: number) {
    if (!url) return;
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      return;
    }
    const value = await props.loadLogo(domain);
    if (!value) return;
    if (expected !== generation) {
      URL.revokeObjectURL(value);
      return;
    }
    setLogo(value);
  }
  createEffect(
    on(
      () => props.url,
      (url) => {
        generation++;
        const previous = logo();
        if (previous) URL.revokeObjectURL(previous);
        setLogo(undefined);
        fireAndForget(load(url, generation), 'passwords-logo');
      }
    )
  );
  onCleanup(() => {
    generation++;
    const value = logo();
    if (value) URL.revokeObjectURL(value);
  });
  const initial = () => props.name.trim().slice(0, 1).toLocaleUpperCase();
  return (
    <div
      aria-hidden="true"
      class={cn(
        'flex shrink-0 items-center justify-center rounded-lg border border-edge-muted bg-panel text-xs font-semibold text-ink-muted',
        props.large ? 'size-9' : 'size-8'
      )}
    >
      <Show
        when={logo()}
        fallback={
          <Show
            when={initial()}
            fallback={
              <Dynamic component={KIND_ICONS[props.kind]} class="size-4" />
            }
          >
            {initial()}
          </Show>
        }
      >
        {(url) => <img class="size-5 object-contain" src={url()} alt="" />}
      </Show>
    </div>
  );
}
