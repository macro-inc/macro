import { cn } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import type { Property } from '../types';
import {
  formatPropertyValue,
  getEntityValues,
  getLinkValues,
  getSelectValues,
  isEntityProperty,
  isLinkProperty,
  isSelectProperty,
} from '../utils';
import { PropertyIcon } from './PropertyIcon';

type Props = {
  property: Property;
  class?: string;
  /** Render-prop for each chip. Defaults to a simple label-only chip. */
  renderChip?: (chip: ChipInfo) => JSX.Element;
};

export type ChipInfo = {
  /** Stable identifier for the chip (option ID, entity ID, URL, etc.). */
  key: string;
  /** Human-readable label. */
  label: string;
};

/**
 * Renders a property's values as a chip list — for SELECT_* multi, ENTITY
 * (non-user), LINK. Caller controls the chip appearance via `renderChip`.
 *
 * For single-value properties returns null (use <PropertyText /> instead).
 */
export const PropertyChips: Component<Props> = (props) => {
  const chips = (): ChipInfo[] => {
    if (isSelectProperty(props.property)) {
      return getSelectValues(props.property).map((id) => ({
        key: id,
        label: formatPropertyValue(props.property, id),
      }));
    }
    if (isEntityProperty(props.property)) {
      return getEntityValues(props.property).map((ref) => ({
        key: `${ref.entity_type}:${ref.entity_id}`,
        label: ref.entity_id,
      }));
    }
    if (isLinkProperty(props.property)) {
      return getLinkValues(props.property).map((url) => ({
        key: url,
        label: url,
      }));
    }
    return [];
  };

  const renderChip =
    props.renderChip ??
    ((chip: ChipInfo) => (
      <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-sm bg-hover">
        <Show when={isSelectProperty(props.property)}>
          <PropertyIcon property={props.property} class="size-3 shrink-0" />
        </Show>
        <span class="truncate">{chip.label}</span>
      </span>
    ));

  return (
    <div class={cn('flex flex-wrap gap-1', props.class)}>
      <For each={chips()}>{(chip) => renderChip(chip)}</For>
    </div>
  );
};
