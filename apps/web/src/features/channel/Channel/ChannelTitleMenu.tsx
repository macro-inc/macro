import { openChatWithAgent } from '@app/features/chat/ChatWithAgentButton';
import { toSingleEntityActionListState } from '@app/features/next-soup/actions';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { SoupEntityActionsDropdown } from '@app/features/soup/SoupEntityActionsDropdown';
import { SoupEntityActionsSheet } from '@app/features/soup/SoupEntityActionsSheet';
import { t } from '@app/lib/i18n';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { MenuItem } from '@core/component/ContextMenu';
import { useChannelName, useChannelType } from '@core/context/channels';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import Check from '@icon/system/regular/check.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import type { TabOption } from '@ui';
import { type ComponentProps, For, type JSX, Show } from 'solid-js';
import { CHANNEL_ACTION_VIEW_CONTEXT } from './channel-actions';
import { useChannelEntity } from './channel-entity';
import type { ChannelTabId } from './channel-tabs';

/**
 * The conversation's entity actions behind the same ellipsis a document's
 * title menu uses. The actions match the channel's row in the rail, so
 * favoriting, muting or renaming a conversation does not depend on finding
 * that row. It also offers Ask Macro, which would otherwise take a top bar
 * button.
 *
 * Owned by the channel top bar rather than by each of its hosts: the menu
 * resolves the conversation from its id, so a surface that opens a channel
 * cannot forget to offer it. On touch it opens as a sheet, like a document's
 * title menu.
 */
export function ChannelTitleMenu(props: {
  channelId: string;
  children?: JSX.Element;
  /** The channel's tabs, offered above the actions in the touch sheet. */
  views?: ChannelTitleMenuViews;
  triggerProps?: ComponentProps<
    typeof SoupEntityActionsDropdown
  >['triggerProps'];
}) {
  const notificationSource = useGlobalNotificationSource();
  const channel = useChannelEntity(() => props.channelId);
  const entity = () => {
    const resolved = channel();
    return resolved && withEntityNotifications(resolved, notificationSource);
  };
  const list = toSingleEntityActionListState(entity);
  const channelName = useChannelName(props.channelId);
  const channelType = useChannelType(props.channelId);

  // Seed for "Ask Macro": a new chat with this channel @mentioned.
  const askMacroEntity = () => {
    const type = channelType();
    if (!type) return undefined;
    return {
      type: 'channel' as const,
      id: props.channelId,
      name: channelName() ?? channel()?.name ?? 'New Channel',
      channelType: type,
    };
  };

  const askMacro = () => {
    const seed = askMacroEntity();
    if (seed) fireAndForget(openChatWithAgent(seed), 'channel-title-menu');
  };
  const triggerProps = () =>
    props.triggerProps ?? {
      size: 'icon-sm' as const,
      'aria-label': 'Channel actions',
    };
  const trigger = () =>
    props.children ?? <DotsThreeIcon class="size-4 shrink-0" />;

  return (
    <Show when={entity()} fallback={props.children}>
      {(current) => (
        <Show
          when={isTouchDevice()}
          fallback={
            <SoupEntityActionsDropdown
              entity={current()}
              list={list}
              viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
              triggerProps={triggerProps()}
              extraItems={
                <Show when={askMacroEntity()}>
                  <MenuItem
                    text={t('entityActions.askMacro')}
                    onClick={askMacro}
                  />
                </Show>
              }
            >
              {trigger()}
            </SoupEntityActionsDropdown>
          }
        >
          <SoupEntityActionsSheet
            entity={current()}
            list={list}
            viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
            triggerProps={triggerProps()}
            extraActions={
              askMacroEntity()
                ? [
                    {
                      id: 'ask-macro',
                      label: t('entityActions.askMacro'),
                      onClick: askMacro,
                    },
                  ]
                : []
            }
            leading={(close) => (
              <Show when={props.views}>
                {(views) => <ViewChoices views={views()} onChosen={close} />}
              </Show>
            )}
          >
            {trigger()}
          </SoupEntityActionsSheet>
        </Show>
      )}
    </Show>
  );
}

type ChannelTitleMenuViews = {
  options: readonly TabOption<ChannelTabId>[];
  value: ChannelTabId;
  onSelect: (value: ChannelTabId) => void;
};

/** The channel's tabs as a radio group, titled apart from the actions. */
function ViewChoices(props: {
  views: ChannelTitleMenuViews;
  onChosen: () => void;
}) {
  return (
    <>
      <MobileDrawer.Label id="channel-title-menu-views-label">
        {t('entityActions.view')}
      </MobileDrawer.Label>
      <MobileDrawer.Section
        role="radiogroup"
        aria-labelledby="channel-title-menu-views-label"
        class="mb-3 flex shrink-0 flex-col"
      >
        <For each={props.views.options}>
          {(option) => (
            <MobileDrawer.Item
              type="button"
              role="radio"
              aria-checked={props.views.value === option.value}
              onClick={() => {
                props.views.onSelect(option.value);
                props.onChosen();
              }}
            >
              <span class="min-w-0 flex-1 truncate">{option.label}</span>
              <Show when={props.views.value === option.value}>
                <Check class="size-3.5 shrink-0 text-accent" />
              </Show>
            </MobileDrawer.Item>
          )}
        </For>
      </MobileDrawer.Section>
      <MobileDrawer.Label>{t('entityActions.actions')}</MobileDrawer.Label>
    </>
  );
}
