import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { toSingleEntityActionListState } from '@app/features/next-soup/actions';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { SoupEntityActionsDropdown } from '@app/features/soup/SoupEntityActionsDropdown';
import { SoupEntityActionsSheet } from '@app/features/soup/SoupEntityActionsSheet';
import { t } from '@app/lib/i18n';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { MenuItem } from '@core/component/ContextMenu';
import { fireAndForget } from '@core/util/fireAndForget';
import Check from '@icon/system/regular/check.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import type { TabOption } from '@ui';
import { type ComponentProps, For, type JSX, Show } from 'solid-js';
import { CHANNEL_ACTION_VIEW_CONTEXT } from './channel-actions';
import { useChannelAskMacroEntity } from './channel-ask-macro';
import { useChannelEntity } from './channel-entity';
import type { ChannelTabId } from './channel-tabs';

/** The conversation's entity, its action list, and its Ask Macro seed. */
function useChannelTitleActions(channelId: () => string) {
  const notificationSource = useGlobalNotificationSource();
  const channel = useChannelEntity(channelId);
  const entity = () => {
    const resolved = channel();
    return resolved && withEntityNotifications(resolved, notificationSource);
  };
  const list = toSingleEntityActionListState(entity);
  const askMacroEntity = useChannelAskMacroEntity(
    channelId,
    () => channel()?.name
  );
  const askMacro = () => {
    const seed = askMacroEntity();
    if (seed) fireAndForget(openChatWithAgent(seed), 'channel-title-menu');
  };
  return { entity, list, askMacroEntity, askMacro };
}

type ChannelTitleMenuProps = {
  channelId: string;
  children?: JSX.Element;
  triggerProps?: ComponentProps<
    typeof SoupEntityActionsDropdown
  >['triggerProps'];
};

const DEFAULT_TRIGGER_PROPS = {
  size: 'icon-sm' as const,
  'aria-label': 'Channel actions',
};

/**
 * The conversation's entity actions behind the same ellipsis a document's
 * title menu uses. The actions match the channel's row in the rail, so
 * favoriting, muting or renaming a conversation does not depend on finding
 * that row. It also offers Ask Macro, as a document's title menu does.
 *
 * Owned by the channel top bar rather than by each of its hosts: the menu
 * resolves the conversation from its id, so a surface that opens a channel
 * cannot forget to offer it. {@link ChannelTitleSheet} is its touch form.
 */
export function ChannelTitleMenu(props: ChannelTitleMenuProps) {
  const actions = useChannelTitleActions(() => props.channelId);
  return (
    <Show when={actions.entity()} fallback={props.children}>
      {(current) => (
        <SoupEntityActionsDropdown
          entity={current()}
          list={actions.list}
          viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
          triggerProps={props.triggerProps ?? DEFAULT_TRIGGER_PROPS}
          extraItems={
            <Show when={actions.askMacroEntity()}>
              <MenuItem
                text={t('entityActions.askMacro')}
                icon={ChatWithAgentIcon}
                onClick={actions.askMacro}
              />
            </Show>
          }
        >
          {props.children ?? <DotsThreeIcon class="size-4 shrink-0" />}
        </SoupEntityActionsDropdown>
      )}
    </Show>
  );
}

/**
 * The touch title menu: the same actions in a sheet, as a document's title
 * menu opens on touch, with the channel's tabs as view choices above them.
 */
export function ChannelTitleSheet(
  props: ChannelTitleMenuProps & { views?: ChannelTitleMenuViews }
) {
  const actions = useChannelTitleActions(() => props.channelId);
  return (
    <Show when={actions.entity()} fallback={props.children}>
      {(current) => (
        <SoupEntityActionsSheet
          entity={current()}
          list={actions.list}
          viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
          triggerProps={props.triggerProps ?? DEFAULT_TRIGGER_PROPS}
          extraActions={
            actions.askMacroEntity()
              ? [
                  {
                    id: 'ask-macro',
                    label: t('entityActions.askMacro'),
                    onClick: actions.askMacro,
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
          {props.children ?? <DotsThreeIcon class="size-4 shrink-0" />}
        </SoupEntityActionsSheet>
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
