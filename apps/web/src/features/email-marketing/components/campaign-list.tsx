import FlowArrowIcon from '@phosphor/flow-arrow.svg';
import { For, Show } from 'solid-js';
import type { Campaign, MarketingSnapshot } from '../core/model';
import { inputClass, primaryButton } from './enrollment-dialog';
import { StatusBadge } from './status-badge';

export function CampaignList(props: {
  campaigns: Campaign[];
  snapshot: MarketingSnapshot;
  busy: boolean;
  activeCount: number;
  upcomingCount: number;
  filter: string;
  statusFilter: string;
  onFilter: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onCreate: () => void;
  onOpen: (campaign: Campaign) => void;
}) {
  return (
    <div class="flex-1 overflow-y-auto p-6 lg:p-9">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-2xl font-semibold tracking-tight">Campaigns</h2>
          <p class="mt-2 text-sm text-ink-muted">
            Build relationships, one email at a time.
          </p>
        </div>
        <button
          type="button"
          class={primaryButton}
          disabled={!props.snapshot.writable || props.busy}
          onClick={props.onCreate}
        >
          ＋ New campaign
        </button>
      </div>
      <div class="my-7 grid grid-cols-3 gap-3">
        <For
          each={[
            { label: 'Active campaigns', value: () => props.activeCount },
            {
              label: 'Contacts enrolled',
              value: () =>
                new Set(
                  props.snapshot.enrollments.map((entry) => entry.contact.email)
                ).size,
            },
            { label: 'Upcoming emails', value: () => props.upcomingCount },
          ]}
        >
          {(metric) => (
            <div class="rounded-xl border border-edge-muted px-5 py-4">
              <p class="text-xs text-ink-muted">{metric.label}</p>
              <p class="mt-2 text-2xl font-medium tracking-tight">
                {metric.value()}
              </p>
            </div>
          )}
        </For>
      </div>
      <div class="mb-4 flex items-center justify-between gap-3">
        <input
          aria-label="Search campaigns"
          class={`${inputClass} max-w-72`}
          placeholder="⌕  Search campaigns"
          value={props.filter}
          onInput={(event) => props.onFilter(event.currentTarget.value)}
        />
        <select
          aria-label="Filter campaign status"
          class="rounded-lg border border-edge-muted bg-input px-3 py-2 text-xs"
          value={props.statusFilter}
          onChange={(event) => props.onStatusFilter(event.currentTarget.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <div class="overflow-hidden rounded-xl border border-edge-muted">
        <div class="grid grid-cols-[1fr_auto] gap-4 border-b border-edge-muted bg-panel/30 px-5 py-3 text-[11px] text-ink-muted sm:grid-cols-[minmax(0,1fr)_110px_85px_85px]">
          <span>Campaign</span>
          <span>Status</span>
          <span class="hidden sm:block">Sequence</span>
          <span class="hidden sm:block">Enrolled</span>
        </div>
        <For each={props.campaigns}>
          {(campaign) => (
            <button
              type="button"
              class="grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-edge-muted px-5 py-5 text-left last:border-0 hover:bg-panel/40 sm:grid-cols-[minmax(0,1fr)_110px_85px_85px]"
              onClick={() => props.onOpen(campaign)}
            >
              <span class="flex min-w-0 items-center gap-3">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-edge-muted bg-panel/40 text-ink-muted">
                  <FlowArrowIcon class="size-5" aria-hidden="true" />
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium">
                    {campaign.name}
                  </span>
                  <span class="mt-1 block truncate text-xs text-ink-muted">
                    {campaign.description ||
                      'An email sequence for your contacts'}
                  </span>
                </span>
              </span>
              <StatusBadge status={campaign.status} />
              <span class="hidden text-xs text-ink-muted sm:block">
                {campaign.steps.length} emails
              </span>
              <span class="hidden text-xs text-ink-muted sm:block">
                {
                  props.snapshot.enrollments.filter(
                    (entry) => entry.campaignId === campaign.id
                  ).length
                }
              </span>
            </button>
          )}
        </For>
        <Show when={!props.campaigns.length}>
          <div class="px-5 py-14 text-center">
            <p class="text-base font-medium">
              {props.filter || props.statusFilter !== 'all'
                ? 'No matching campaigns'
                : 'Your next conversation starts here'}
            </p>
            <p class="mt-2 text-sm text-ink-muted">
              {props.filter
                ? 'Try another search.'
                : 'Create a campaign, write a sequence, and enroll your contacts.'}
            </p>
          </div>
        </Show>
      </div>
      <p class="mt-4 text-xs text-ink-subtle">
        Sequences work with your contacts, whether or not you use CRM.
      </p>
    </div>
  );
}
