import { cn } from '@ui';
import { Show } from 'solid-js';
import { MultiSelectCheckbox } from '../../components/MultiSelectCheckbox';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import { Entity } from '../../entity';
import type { EmailEntity } from '../../types/entity';
import { EmailIdentity, EmailInboxChip, EmailNarrowSnippet } from './email';
import { RowEnd } from './row-end';
import { InboxDivider, type LayoutProps } from './shared';

/**
 * An email row stacked for narrow desktop lists (the reading pane's list):
 * senders and date, then subject, then one line of preview. The unread dot
 * sits in a slim gutter instead of a per-type icon, which is the same on
 * every email row, so the text keeps the width. Narrow lists on touch devices
 * (phones) use `NarrowInboxLayout`, with the sender's picture.
 */
export function NarrowEmailLayout(
  props: LayoutProps & { entity: EmailEntity }
) {
  const weight = () => (props.unread ? 'font-semibold' : 'font-normal');

  return (
    <Entity.Layout
      class="grid w-full text-sm"
      style={{
        'grid-template-columns': 'var(--soup-inbox-unread) 1fr auto',
        'grid-template-areas':
          '"icon title timestamp" ". subject subject" ". body body"',
        // The divider starts at the text, with no icon column before it.
        '--soup-inbox-left-of-content': 'var(--soup-inbox-unread)',
      }}
    >
      <Entity.Slot
        placement="icon"
        class="group/check grid place-items-center self-center pt-2.5"
      >
        <Show
          when={!props.hideCheckbox && props.checked}
          fallback={
            <>
              <UnreadIndicator
                class={cn(
                  '[grid-area:1/1] size-2',
                  !props.hideCheckbox && 'not-touch:group-hover/check:hidden'
                )}
                active={props.unread}
              />
              <Show when={!props.hideCheckbox}>
                <div class="[grid-area:1/1] hidden not-touch:group-hover/check:block">
                  <MultiSelectCheckbox
                    checked={props.checked}
                    onChecked={props.onChecked}
                  />
                </div>
              </Show>
            </>
          }
        >
          <MultiSelectCheckbox
            checked={props.checked}
            onChecked={props.onChecked}
          />
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class={cn(
          'ph-no-capture flex min-w-0 items-center gap-2 pt-2.5 text-ink',
          weight()
        )}
      >
        <EmailIdentity entity={props.entity} />
        <EmailInboxChip entity={props.entity} class="ml-auto" />
      </Entity.Slot>

      <Entity.Slot
        placement="timestamp"
        class="flex items-center justify-end pt-2.5 pr-3 pl-2 text-xs text-ink-extra-muted"
      >
        <RowEnd actions={props.actions} leadingAction={props.leadingAction}>
          <span class="flex items-center gap-1">
            {props.scheduleStatus}
            <Show when={!props.hasNotifications}>
              <Entity.Timestamp entity={props.entity} />
            </Show>
          </span>
        </RowEnd>
      </Entity.Slot>

      <Entity.Slot
        placement="subject"
        class={cn('ph-no-capture min-w-0 truncate pr-3 text-ink', weight())}
      >
        <Entity.Title entity={props.entity} />
      </Entity.Slot>

      <EmailNarrowSnippet
        entity={props.entity}
        chars={props.chars}
        showHitSnippet={props.showHitSnippet}
        setContainerRef={props.setSnippetContainerRef}
      />
      <InboxDivider />
    </Entity.Layout>
  );
}
