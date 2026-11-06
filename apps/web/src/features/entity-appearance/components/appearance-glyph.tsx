import type { Component, JSX } from 'solid-js';
import { children, lazy, Match, Suspense, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { EntityAppearance } from '../core/appearance';
import { ENTITY_ICON_ALIASES } from '../core/catalog.generated';

const GLYPH_MODULES = import.meta.glob<
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
>('/src/components/icon/entity/*.svg', { import: 'default' });
const GLYPHS = new Map(
  Object.entries(GLYPH_MODULES).map(([path, load]) => [
    path.split('/').at(-1)?.replace('.svg', ''),
    lazy(async () => ({ default: await load() })),
  ])
);
const ALIASES = new Map(Object.entries(ENTITY_ICON_ALIASES));

/** Presentation only: no entity fetches, mutation state, or icon-picker imports. */
export function AppearanceGlyph(props: {
  appearance?: EntityAppearance | null;
  children: JSX.Element;
}) {
  const fallback = children(() => props.children);
  const macro = () => {
    const icon = props.appearance?.icon;
    return icon?.kind === 'macro'
      ? GLYPHS.get(ALIASES.get(icon.name) ?? icon.name)
      : undefined;
  };
  const emoji = () => {
    const icon = props.appearance?.icon;
    return icon?.kind === 'emoji' ? icon.value : undefined;
  };
  return (
    <Switch fallback={fallback()}>
      <Match when={emoji()}>
        {(value) => (
          <span
            aria-hidden="true"
            class="emoji flex size-full items-center justify-center leading-none"
            style={{ 'font-size': '90cqi' }}
          >
            {value()}
          </span>
        )}
      </Match>
      <Match when={macro()}>
        {(glyph) => (
          <Suspense fallback={fallback()}>
            <Dynamic component={glyph()} class="size-full" />
          </Suspense>
        )}
      </Match>
    </Switch>
  );
}
