/**
 * Stage icon that works for both the builtin system stages and
 * team-customized stage options. System stage option ids render through
 * `PropertyValueIcon` (fixed tints); custom option ids — which
 * `PropertyValueIcon` doesn't know — render as a colored dot with a tint
 * picked from a small palette by column index (or a stable hash of the
 * option id when no index is supplied).
 */

import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { getHashedPaletteColor } from '@ui/utils/palette';
import { Show } from 'solid-js';
import { twMerge } from 'tailwind-merge';

const SYSTEM_STAGE_OPTION_IDS = new Set<string>(
  Object.values(PROPERTY_OPTION_IDS.STAGE)
);

const STAGE_TINT_PALETTE = [
  'text-ink-muted',
  'text-task',
  'text-note',
  'text-alert-ink',
  'text-accent',
  'text-success',
  'text-failure-ink',
] as const;

export function CrmStageIcon(props: {
  optionId: string;
  index?: number;
  class?: string;
}) {
  const tint = () =>
    props.index === undefined
      ? getHashedPaletteColor(props.optionId, {
          palette: STAGE_TINT_PALETTE,
        })
      : STAGE_TINT_PALETTE[props.index % STAGE_TINT_PALETTE.length];

  return (
    <Show
      when={!SYSTEM_STAGE_OPTION_IDS.has(props.optionId)}
      fallback={
        <PropertyValueIcon optionId={props.optionId} class={props.class} />
      }
    >
      {/* Same filled dot PropertyValueIcon uses for the system stages. */}
      <svg
        viewBox="0 0 12 12"
        class={twMerge('size-3', props.class, tint())}
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="4" fill="currentColor" />
      </svg>
    </Show>
  );
}
