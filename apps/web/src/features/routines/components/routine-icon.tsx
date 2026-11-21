import { cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import { AppearanceGlyph } from '../../entity-appearance/components/appearance-glyph';
import {
  appearanceColor,
  type EntityAppearance,
} from '../../entity-appearance/core/appearance';
import type { TriggerKind } from '../core/routine-triggers';
import { triggerKindIcon } from './routine-trigger-icons';

/**
 * A routine's icon, the same wherever its page shows it: the icon chosen for
 * it, else its first trigger's. A chosen colour tints it; without one it takes
 * the surrounding ink.
 */
export function RoutineIcon(props: {
  appearance?: EntityAppearance | null;
  trigger?: TriggerKind;
  class?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="routine-icon"
      class={cn('flex shrink-0 items-center justify-center', props.class)}
      // An emoji is sized against the icon's width.
      style={{
        color: appearanceColor(props.appearance?.color),
        'container-type': 'inline-size',
      }}
    >
      <AppearanceGlyph appearance={props.appearance}>
        <Dynamic component={triggerKindIcon(props.trigger)} class="size-full" />
      </AppearanceGlyph>
    </span>
  );
}
