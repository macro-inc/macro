import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { cn } from '@ui';
import { createMemo, type JSX, Show } from 'solid-js';
import { InboxItem } from '../InboxItem';
import {
  InboxItemActionRow,
  InboxItemActionText,
  InboxItemBadge,
  InboxItemBody,
  InboxItemCard,
  InboxItemContentRow,
  InboxItemLeadingAvatar,
  type InboxItemLayoutProps,
  InboxItemMetaRow,
} from './shared';
import { getInboxItemText } from './utils';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';

/**
 * Default single-item layout: leading avatar, an action-text title, a content
 * preview line, attachments and a timestamp. Item-specific layouts compose this
 * and pass slots for the bits that differ (e.g. a leading icon or trailing
 * pills); when a type needs a fully different shape it stops delegating here.
 */
export function GenericItemLayout(
  props: InboxItemLayoutProps & {
    /** Rendered before the action text (e.g. a source icon). */
    actionLeading?: JSX.Element;
    /** Rendered after the content preview (e.g. property pills). */
    contentTrailing?: JSX.Element;
    /** Overrides the content preview class; defaults to `flex-1`. */
    contentClass?: string;
  }
) {
  const item = () => props.item;
  const content = createMemo(() => getInboxItemText(item()).content);

  return (
    <InboxItemCard
      unread={props.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      <InboxItemLeadingAvatar item={item()} />
      <InboxItemBody class="gap-2">
        <div class="flex flex-col gap-2">
          <div class="flex flex-col gap-1">
            <InboxItemActionRow unread={props.unread}>
              {props.actionLeading}
              <InboxItemActionText item={item()} nested={props.nested} />
              <InboxItemBadge unread={item().unread} />
            </InboxItemActionRow>
            <InboxItemContentRow>
              <Show when={content()?.trim()}>
                {(value) => (
                  <p
                    class={cn(
                      'min-w-0 truncate text-sm text-ink/60',
                      props.contentClass ?? 'flex-1'
                    )}
                  >
                    <StaticMarkdown
                      markdown={value()}
                      singleLine
                      theme={unifiedListMarkdownTheme}
                    />
                  </p>
                )}
              </Show>
              {props.contentTrailing}
            </InboxItemContentRow>
          </div>
          <InboxItem.AttachmentPreviews
            attachments={item().attachments}
            class="mt-1"
          />
        </div>
        <InboxItemMetaRow item={item()} />
      </InboxItemBody>
    </InboxItemCard>
  );
}
