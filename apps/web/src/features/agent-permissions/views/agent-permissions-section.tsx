import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ShieldCheckIcon from '@icon/system/regular/shield-check.svg';
import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { SettingsSection } from '../../settings/primitives';
import { asksPhrase, neverPhrase } from '../components/labels';
import { PermissionStateGlyph } from '../components/permission-state-glyph';
import { restrictionCount, restrictions } from '../core/model';
import {
  useAgentToolPermissionsQuery,
  useToolPermissionCatalogQuery,
} from '../queries/permissions';

/** The editor shows this many restrictions before "N more". */
const SHOWN_RESTRICTIONS = 2;

/**
 * The agent editor's Permissions section: how restricted the agent is, and
 * Manage, which opens the permissions page. Not rendered when the feature
 * is unavailable for this agent.
 */
export function AgentPermissionsSection(props: {
  agentId: string;
  onManage: () => void;
}) {
  const catalogQuery = useToolPermissionCatalogQuery();
  const viewQuery = useAgentToolPermissionsQuery(() => props.agentId);

  const pending = () => catalogQuery.isPending || viewQuery.isPending;
  // A failed refetch keeps the cached summary on screen (FE-48).
  const failed = () =>
    !pending() &&
    ((catalogQuery.isError && catalogQuery.data === undefined) ||
      (viewQuery.isError && viewQuery.data === undefined));
  const loaded = () => {
    if (pending() || failed()) return undefined;
    const catalog = catalogQuery.data;
    const view = viewQuery.data;
    if (!catalog || !view) return undefined;
    return { catalog, view };
  };
  // A 404 (feature off) hides the whole section.
  const unavailable = () =>
    !pending() &&
    !failed() &&
    (catalogQuery.data === null || viewQuery.data === null);

  const summary = () => {
    const data = loaded();
    if (!data) return undefined;
    const list = restrictions(data.catalog, data.view);
    const groupName = (id: string) =>
      data.catalog.groups.find((group) => group.id === id)?.name ?? id;
    return {
      count: restrictionCount(data.view),
      shown: list.slice(0, SHOWN_RESTRICTIONS).map((entry) => ({
        state: entry.state,
        text: t('agentPermissions.inGroup', {
          phrase:
            entry.state === 'ask'
              ? asksPhrase(entry.action)
              : neverPhrase(entry.action),
          group: groupName(entry.group),
        }),
      })),
      more: Math.max(0, list.length - SHOWN_RESTRICTIONS),
    };
  };

  const retry = () => {
    if (catalogQuery.isError) {
      fireAndForget(catalogQuery.refetch(), 'agent-permissions');
    }
    if (viewQuery.isError) {
      fireAndForget(viewQuery.refetch(), 'agent-permissions');
    }
  };

  return (
    <Show when={!unavailable()}>
      <SettingsSection
        title={t('agentPermissions.title')}
        description={t('agentPermissions.sectionDescription')}
      >
        <div class="flex flex-wrap items-center gap-3 pt-2">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink-muted">
            <ShieldCheckIcon aria-hidden="true" class="size-4" />
          </span>
          <div class="flex min-w-0 flex-1 basis-56 flex-col gap-1">
            <Switch>
              <Match when={pending()}>
                <ListSkeleton.Bar class="h-3 w-28" />
                <ListSkeleton.Bar class="h-2.5 w-56 max-w-full" />
              </Match>
              <Match when={failed()}>
                <p class="text-sm text-ink">
                  {t('agentPermissions.loadFailed')}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  class="self-start"
                  onClick={retry}
                >
                  {t('agentPermissions.tryAgain')}
                </Button>
              </Match>
              <Match when={summary()}>
                {(current) => (
                  <>
                    <p class="text-sm font-medium text-ink">
                      {current().count === 0
                        ? t('agentPermissions.allAllowed')
                        : t('agentPermissions.restrictionCount', {
                            count: current().count,
                          })}
                    </p>
                    <p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink">
                      <Show
                        when={current().shown.length > 0}
                        fallback={
                          <span class="text-ink-muted">
                            {t('agentPermissions.allAllowedBody')}
                          </span>
                        }
                      >
                        <For each={current().shown}>
                          {(entry, index) => (
                            <>
                              <Show when={index() > 0}>
                                <span
                                  aria-hidden="true"
                                  class="text-ink-disabled"
                                >
                                  ·
                                </span>
                              </Show>
                              <span class="inline-flex items-center gap-1">
                                <PermissionStateGlyph
                                  state={entry.state}
                                  class="size-3.5"
                                />
                                {entry.text}
                              </span>
                            </>
                          )}
                        </For>
                        <Show when={current().more > 0}>
                          <span aria-hidden="true" class="text-ink-disabled">
                            ·
                          </span>
                          <span class="text-ink-muted">
                            {t('agentPermissions.moreRestrictions', {
                              count: current().more,
                            })}
                          </span>
                        </Show>
                      </Show>
                    </p>
                  </>
                )}
              </Match>
            </Switch>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            class="touch:w-full"
            disabled={!summary()}
            onClick={() => props.onManage()}
          >
            {t('agentPermissions.manage')}
            <CaretRightIcon class="size-3.5 shrink-0 pointer-events-none" />
          </Button>
        </div>
      </SettingsSection>
    </Show>
  );
}
