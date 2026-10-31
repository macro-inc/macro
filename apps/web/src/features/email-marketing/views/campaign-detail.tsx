import { t } from '@app/lib/i18n';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { Button, Tabs } from '@ui';
import { createMemo, type JSX, Show } from 'solid-js';
import { EnrollmentList } from '../components/enrollment-list';
import { SectionHeader } from '../components/section-header';
import { SequenceEditor } from '../components/sequence-editor';
import { attentionDetail, StatusBadge } from '../components/status-badge';
import {
  type Campaign,
  type Enrollment,
  isUnsubscribed,
  type MarketingContact,
} from '../core/model';
import type { MarketingWorkspace } from '../primitives/workspace';

export type DetailTab = 'sequence' | 'enrollments';

export function CampaignDetail(props: {
  workspace: MarketingWorkspace;
  campaign: Campaign;
  changed: boolean;
  /** Edited here while the stored campaign changed elsewhere. */
  conflict: boolean;
  tab: DetailTab;
  touchNavigation: JSX.Element;
  banners: JSX.Element;
  onTab: (tab: DetailTab) => void;
  onChange: (campaign: Campaign) => void;
  onDiscard: () => void;
  onBack: () => void;
  onSave: (activate: boolean) => void;
  onPause: () => void;
  onEnroll: () => void;
  onDelete: () => void;
  onPreview: (stepIndex: number) => void;
  onStop: (entry: Enrollment, status: 'paused' | 'stopped') => void;
  onResume: (entry: Enrollment) => void;
  onUnsubscribe: (contact: MarketingContact) => void;
  onOpenContact: (contact: MarketingContact) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const ws = () => props.workspace;
  const active = () => props.campaign.status === 'active';
  const locked = () => ws().locked();
  const campaignId = createMemo(() => props.campaign.id);
  const entries = createMemo(() =>
    ws()
      .snapshot()
      .enrollments.filter((entry) => entry.campaignId === campaignId())
  );
  const enrolled = createMemo(() => entries().length);
  // Built once per count, so typing never rebuilds the tabs.
  const tabs = createMemo(() => [
    { value: 'sequence' as const, label: t('emailMarketing.sequence') },
    {
      value: 'enrollments' as const,
      label: t('emailMarketing.enrollments'),
      count: enrolled(),
    },
  ]);
  const inboxProblem = () => {
    const status = props.campaign.senderId
      ? ws().senderStatus(props.campaign.senderId)
      : undefined;
    return status === 'reauth' || status === 'disconnected'
      ? status
      : undefined;
  };
  return (
    <>
      <SectionHeader
        touchNavigation={props.touchNavigation}
        title={
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('emailMarketing.allCampaigns')}
              tooltip={t('emailMarketing.allCampaigns')}
              disabled={ws().busy()}
              onClick={() => props.onBack()}
            >
              <ArrowLeftIcon class="size-4" aria-hidden="true" />
            </Button>
            <h2 class="min-w-0 truncate text-sm font-semibold">
              {props.campaign.name}
            </h2>
            <StatusBadge status={props.campaign.status} />
            <Tabs<DetailTab>
              aria-label={t('emailMarketing.campaignViews')}
              value={props.tab}
              onChange={props.onTab}
              options={tabs()}
            />
          </div>
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-md"
              aria-label={t('common.delete')}
              tooltip={t('common.delete')}
              disabled={locked()}
              onClick={() => props.onDelete()}
            >
              <TrashIcon class="size-4" aria-hidden="true" />
            </Button>
            <Show
              when={active()}
              fallback={
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={locked() || !props.changed}
                    onClick={() => props.onSave(false)}
                  >
                    {t('emailMarketing.saveDraft')}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={locked()}
                    onClick={() => props.onSave(true)}
                  >
                    {t('emailMarketing.activate')}
                  </Button>
                </>
              }
            >
              <Button
                type="button"
                variant="secondary"
                disabled={locked()}
                onClick={() => props.onPause()}
              >
                {t('emailMarketing.pauseCampaign')}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={locked() || !!inboxProblem()}
                onClick={() => props.onEnroll()}
              >
                {t('emailMarketing.enrollContacts')}
              </Button>
            </Show>
          </>
        }
      />
      {props.banners}
      <Show when={inboxProblem()}>
        {(status) => (
          <p class="mx-4 mb-2 text-xs text-failure" role="alert">
            {status() === 'reauth'
              ? t('emailMarketing.reconnectBeforeEnrolling')
              : attentionDetail('disconnected')}
          </p>
        )}
      </Show>
      <Show when={props.conflict}>
        <div class="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-panel px-4 py-2 text-xs">
          {t('emailMarketing.changedElsewhereNotice')}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => props.onDiscard()}
          >
            {t('emailMarketing.discardChanges')}
          </Button>
        </div>
      </Show>
      {/* Leaving saves edits; discarding is the way out when they can't be. */}
      <Show when={props.changed && !props.conflict && !active()}>
        <div class="mx-4 mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {t('emailMarketing.unsavedChanges')}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={ws().busy()}
            onClick={() => props.onDiscard()}
          >
            {t('emailMarketing.discardChanges')}
          </Button>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-8 lg:px-8">
        <Show
          when={props.tab === 'sequence'}
          fallback={
            <EnrollmentList
              entries={entries()}
              campaignActive={active()}
              disabled={locked()}
              isUnsubscribed={(email) => isUnsubscribed(ws().snapshot(), email)}
              attention={ws().enrollmentAttention}
              isFinished={ws().isFinished}
              stepIssue={ws().stepIssue}
              stepSent={ws().stepSent}
              onPause={(entry) => props.onStop(entry, 'paused')}
              onResume={props.onResume}
              onStop={(entry) => props.onStop(entry, 'stopped')}
              onUnsubscribe={props.onUnsubscribe}
              onOpenContact={props.onOpenContact}
              onOpenThread={props.onOpenThread}
            />
          }
        >
          <Show when={active()}>
            <p class="mx-auto mb-5 max-w-3xl rounded-lg bg-panel px-4 py-3 text-xs text-ink-muted">
              {t('emailMarketing.pauseToEdit')}
            </p>
          </Show>
          <SequenceEditor
            campaign={props.campaign}
            senders={ws().senders()}
            disabled={active() || locked()}
            onChange={props.onChange}
            onPreview={props.onPreview}
          />
        </Show>
      </div>
    </>
  );
}
