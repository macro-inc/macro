import { ViewSidebar } from '@app/components/view-shell';
import {
  compileToAst,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { VIEW_TAB_PRESETS } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { t } from '@app/lib/i18n';
import { usePreference } from '@app/preferences/use-preference';
import { getEntityClickContent } from '@channel/Attachments/attachment-utils';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { Entity, type EntityData } from '@entity';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { unreadFilterFn } from '@entity/utils/filter';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { ToggleSwitch } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { useSplitLayout } from '../split-layout/layout';

/** How many recent items the sidebar lists. */
const RECENTS_LIMIT = 30;

// Home's All tab: everything Home lists, by when it last changed.
function recentsQueryArgs(userId: string | undefined): SoupAstItemsQueryArgs {
  const preset = VIEW_TAB_PRESETS.home.tabs.all?.({
    userId,
    isTeamAdmin: false,
  });
  return {
    params: {
      expand: true,
      limit: RECENTS_LIMIT,
      sort_method: 'updated_at',
      sort_direction: 'desc',
    },
    body: compileToAst(queryStateFrom(preset?.filters ?? {})),
  };
}

/**
 * The single sidebar's Recents: everything Home's All tab lists, newest change
 * first, opening where a row of that kind opens.
 */
export function RecentsSection() {
  const userId = useUserId();
  const layout = useSplitLayout();
  const notificationSource = useGlobalNotificationSource();
  const query = useSoupAstItemsQuery(
    () => recentsQueryArgs(userId()),
    () => ({
      enabled: Boolean(userId()),
    })
  );
  // Pending reads suspend; keep the section's rows until a page answers.
  const entities = createMemo(() =>
    query.isPending ? [] : (query.data?.entities ?? [])
  );
  const isUnread = (entity: EntityData) =>
    unreadFilterFn(withEntityNotifications(entity, notificationSource));
  const [unreadOnly, setUnreadOnly] = usePreference<boolean>(
    'macro:pref:single-sidebar:recents-unread-only',
    { default: false }
  );
  const listed = () =>
    unreadOnly() ? entities().filter(isUnread) : entities();

  return (
    <ViewSidebar.Nav aria-label={t('nav.recents')} class="pt-4">
      <div class="flex h-6 shrink-0 items-center justify-between gap-2 px-(--sidebar-item-inset)">
        <h3 class="text-xs font-medium text-ink-muted">{t('nav.recents')}</h3>
        <ToggleSwitch
          size="xs"
          label={t('nav.unreadOnly')}
          labelClass="text-xs text-ink-muted"
          checked={unreadOnly()}
          onChange={setUnreadOnly}
        />
      </div>
      <For each={listed()}>
        {(entity) => (
          <ViewSidebar.Item
            class="cursor-default"
            onClick={(event) =>
              layout.openWithSplit(getEntityClickContent(entity), {
                preferNewSplit: event.shiftKey,
                referredFrom: 'sidebar',
              })
            }
          >
            <ViewSidebar.Icon>
              <Entity.Icon entity={entity} suppressClick showTooltip={false} />
            </ViewSidebar.Icon>
            <span
              class={
                isUnread(entity)
                  ? 'min-w-0 flex-1 truncate text-ink'
                  : 'min-w-0 flex-1 truncate'
              }
            >
              {entity.name}
            </span>
            <Show when={isUnread(entity)}>
              <span aria-hidden="true" class="flex size-3.5 items-center">
                <UnreadIndicator active class="size-1.5" />
              </span>
            </Show>
          </ViewSidebar.Item>
        )}
      </For>
      <Show when={query.error && !query.isPending}>
        <ViewSidebar.Item
          class="cursor-default"
          onClick={() =>
            fireAndForget(query.refetch(), 'single-sidebar-recents')
          }
        >
          <ViewSidebar.Icon />
          <span class="truncate">{t('nav.retryRecents')}</span>
        </ViewSidebar.Item>
      </Show>
    </ViewSidebar.Nav>
  );
}
