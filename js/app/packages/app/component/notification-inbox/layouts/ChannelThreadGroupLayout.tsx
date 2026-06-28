import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Show } from 'solid-js';
import { InboxItem } from '../InboxItem';
import {
  InboxItemActionRow,
  InboxItemBadge,
  InboxItemBody,
  InboxItemCard,
  InboxItemLeadingAvatar,
  InboxItemLeadingGroupIcon,
  type InboxItemLayoutProps,
  InboxItemMetaRow,
  InboxItemSenderSummary,
} from './shared';
import {
  getContentText,
  getDisplayLocation,
  getGroupCount,
  getGroupUnreadCount,
  shouldUseGroupIcon,
} from './utils';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';

/**
 * Grouped notifications (an item with sub-items): the channel/thread is the
 * title, participants are summarised, and the row can be expanded to reveal the
 * sub-items.
 */
export function ChannelThreadGroupLayout(props: InboxItemLayoutProps) {
  const item = () => props.item;
  const content = () => getContentText(item(), true);
  const title = () =>
    getDisplayLocation(item(), props.nested) ??
    item().targetName ??
    item().entityName;
  const unreadCount = () => getGroupUnreadCount(item());
  const count = () => unreadCount() || getGroupCount(item());
  const groupItems = () => item().subItems ?? [item()];

  return (
    <InboxItemCard
      unread={props.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      <Show
        when={shouldUseGroupIcon(item())}
        fallback={<InboxItemLeadingAvatar item={item()} />}
      >
        <InboxItemLeadingGroupIcon item={item()} />
      </Show>
      <InboxItemBody class="gap-2">
        <div class="flex flex-col gap-2">
          <div class="flex flex-col gap-1">
            <InboxItemActionRow unread={props.unread}>
              <span>{title()}</span>
              <InboxItemBadge count={count()} countUnread={unreadCount() > 0} />
            </InboxItemActionRow>
            <Show when={content()}>
              {(value) => (
                <div class="flex min-w-0 flex-1 items-center gap-1 text-sm text-ink/60">
                  <InboxItem.Sender
                    item={item()}
                    showName={false}
                    avatarClass="size-4 text-[8px]"
                    class="relative"
                  />
                  <span class="shrink-0 font-medium text-ink/70">
                    <InboxItemSenderSummary items={groupItems()} />
                  </span>
                  <span class="shrink-0">replied:</span>
                  <span class="min-w-0 truncate">
                    <StaticMarkdown
                      markdown={value()}
                      theme={unifiedListMarkdownTheme}
                      singleLine
                    />
                  </span>
                </div>
              )}
            </Show>
          </div>
          <InboxItem.AttachmentPreviews
            attachments={item().attachments}
            class="mt-1"
          />
        </div>

        <InboxItemMetaRow
          item={item()}
          expandable
          expanded={props.expanded}
          onToggleExpanded={props.onToggleExpanded}
        />
      </InboxItemBody>
    </InboxItemCard>
  );
}
