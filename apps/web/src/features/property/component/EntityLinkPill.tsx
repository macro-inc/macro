import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { createCallback } from '@solid-primitives/rootless';
import { ButtonGroup, cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { useProperty } from '../core/context';
import { usePropertyEntityDisplay } from '../hooks/usePropertyEntityDisplay';
import type { Property } from '../types';
import { getEntityValues } from '../utils/typeGuards';

/**
 * A single referenced item as a split pill: the name opens the item through the
 * mention-link path (Shift opens a new split) and the caret changes it. A value
 * the link path can't open stays the plain `fallback` pill.
 */
export function EntityLinkPill(props: {
  property: Property;
  fallback: JSX.Element;
  openLabel: (name: string) => string;
  changeLabel: string;
  /** The property's name, shown before the value as the plain pill does. */
  label?: string;
  leadingIcon?: JSX.Element;
  class?: string;
  iconClass?: string;
  variant?: 'secondary' | 'ghost';
}) {
  const ctx = useProperty();
  const reference = () => getEntityValues(props.property)[0];
  const display = usePropertyEntityDisplay(
    () => reference()?.entity_id ?? '',
    () => reference()?.entity_type,
    {
      iconSize: 'fill',
      specificMessageId: () => reference()?.specific_message_id,
      loadingName: () => ctx.pickedEntityName(reference()?.entity_id ?? ''),
    }
  );
  const open = createCallback((event: MouseEvent) => {
    event.stopPropagation();
    const value = reference();
    const type = display.blockOrFileType();
    if (!value || !type) return;
    openDocument(type, value.entity_id, display.linkParams(), event.shiftKey);
  });

  // A document's type is known only once its preview loads; keep the split
  // pill mounted meanwhile so the swap can't drop focus or shift the row.
  const isLinkable = () =>
    Boolean(reference() && (display.blockOrFileType() || display.isLoading()));

  return (
    <Show when={isLinkable()} fallback={props.fallback}>
      <ButtonGroup
        variant={props.variant ?? 'secondary'}
        finish={props.variant === 'ghost' ? undefined : 'raised'}
        size="xs"
        class={cn('min-w-0 max-w-full border-0', props.class)}
      >
        <ButtonGroup.Button
          data-property-row-action
          aria-label={props.openLabel(display.name())}
          class="min-w-0 shrink justify-start"
          disabled={!display.blockOrFileType()}
          onClick={open}
        >
          <Show when={props.label}>
            {(label) => <span class="shrink-0 text-ink-muted">{label()}:</span>}
          </Show>
          {props.leadingIcon}
          <span
            aria-hidden="true"
            class={cn(
              'inline-flex size-3 shrink-0 items-center justify-center',
              props.iconClass
            )}
          >
            {display.icon()}
          </span>
          <span class="min-w-0 max-w-60 truncate">{display.name()}</span>
        </ButtonGroup.Button>
        <Show when={ctx.canEdit()}>
          <ButtonGroup.Divider />
          <ButtonGroup.Button
            size="icon-xs"
            aria-label={props.changeLabel}
            aria-expanded={ctx.editorOpen()}
            onClick={(event) => {
              event.stopPropagation();
              if (ctx.onEdit) ctx.onEdit(ctx.property(), event.currentTarget);
              else ctx.openEditor(event.currentTarget);
            }}
          >
            <CaretDownIcon class="size-3 shrink-0" />
          </ButtonGroup.Button>
        </Show>
      </ButtonGroup>
    </Show>
  );
}
