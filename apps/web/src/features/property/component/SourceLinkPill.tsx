import { t } from '@app/lib/i18n';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import SourceIcon from '@icon/system/regular/link.svg';
import { createCallback } from '@solid-primitives/rootless';
import { ButtonGroup, cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { useProperty } from '../core/context';
import { usePropertyEntityDisplay } from '../hooks/usePropertyEntityDisplay';
import type { Property } from '../types';
import { getEntityValues } from '../utils/typeGuards';

/** The item opens through the mention-link path; the caret edits the reference. */
export function SourceLinkPill(props: {
  property: Property;
  fallback: JSX.Element;
  class?: string;
  iconClass?: string;
  variant?: 'secondary' | 'ghost';
  showSourceIcon?: boolean;
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
    const source = reference();
    const type = display.blockOrFileType();
    if (!source || !type) return;
    openDocument(type, source.entity_id, display.linkParams(), event.shiftKey);
  });

  return (
    <Show
      when={reference() && display.blockOrFileType()}
      fallback={props.fallback}
    >
      <ButtonGroup
        variant={props.variant ?? 'secondary'}
        finish={props.variant === 'ghost' ? undefined : 'raised'}
        size="xs"
        class={cn('min-w-0 max-w-full border-0', props.class)}
      >
        <ButtonGroup.Button
          data-property-row-action
          aria-label={t('entityActions.openSourceNamed', {
            name: display.name(),
          })}
          class="min-w-0 shrink justify-start"
          onClick={open}
        >
          <Show when={props.showSourceIcon !== false}>
            <SourceIcon
              class={cn('size-3 shrink-0 text-ink-muted', props.iconClass)}
            />
          </Show>
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
            aria-label={t('entityActions.changeSource')}
            aria-expanded={ctx.editorOpen()}
            onClick={(event) => {
              event.stopPropagation();
              ctx.openEditor(event.currentTarget);
            }}
          >
            <CaretDownIcon class="size-3 shrink-0" />
          </ButtonGroup.Button>
        </Show>
      </ButtonGroup>
    </Show>
  );
}
