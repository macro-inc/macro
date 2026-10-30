import { t } from '@app/lib/i18n';
import FlowArrowIcon from '@icon/system/regular/tree-structure.svg';
import { Badge, EmptyStatePanel } from '@ui';
import { For, Show } from 'solid-js';
import type { Campaign } from '../core/model';
import { StatusBadge } from './status-badge';

export type CampaignRow = {
  campaign: Campaign;
  enrolled: number;
  attention: number;
};

export function CampaignList(props: {
  rows: CampaignRow[];
  filtered: boolean;
  canCreate: boolean;
  onCreate: () => void;
  onOpen: (campaign: Campaign) => void;
}) {
  return (
    <Show
      when={props.rows.length}
      fallback={
        <EmptyStatePanel
          centered
          title={
            props.filtered
              ? t('emailMarketing.noMatchingCampaigns')
              : t('emailMarketing.noCampaigns')
          }
          description={
            props.filtered
              ? t('emailMarketing.noMatchingCampaignsHint')
              : t('emailMarketing.noCampaignsHint')
          }
          primaryAction={
            props.filtered || !props.canCreate
              ? undefined
              : {
                  label: t('emailMarketing.newCampaign'),
                  onClick: props.onCreate,
                }
          }
        />
      }
    >
      <ul
        class="flex flex-col px-2 pb-6"
        aria-label={t('emailMarketing.campaigns')}
      >
        <For each={props.rows}>
          {(row) => (
            <li>
              <button
                type="button"
                class="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none not-touch:hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-accent touch:min-h-[44px]"
                onClick={() => props.onOpen(row.campaign)}
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge-muted text-ink-muted">
                  <FlowArrowIcon class="size-4" aria-hidden="true" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">
                    {row.campaign.name}
                  </span>
                  <span class="block truncate text-xs text-ink-muted">
                    {row.campaign.description ||
                      t('emailMarketing.emailCount', {
                        count: row.campaign.steps.length,
                      })}
                  </span>
                </span>
                <Show when={row.attention}>
                  <Badge variant="secondary" size="xs" class="text-failure">
                    {t('emailMarketing.needAttentionCount', {
                      count: row.attention,
                    })}
                  </Badge>
                </Show>
                <span class="hidden shrink-0 text-xs text-ink-muted sm:block">
                  {t('emailMarketing.enrolledCount', { count: row.enrolled })}
                </span>
                <StatusBadge status={row.campaign.status} />
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
