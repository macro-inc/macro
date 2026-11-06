import { ViewShell } from '@app/components/view-shell';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { createSearchParams } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { useCallRecordQuery } from '@queries/call/call';
import {
  hasSoupEntity,
  optimisticUpdateSoupItemViewedAt,
  refetchSoupEntity,
} from '@queries/soup/cache';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { Button } from '@ui';
import {
  type Accessor,
  createMemo,
  type JSX,
  Match,
  onMount,
  type ParentProps,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { callDetailSearch } from '../call-route';
import { CallRecordingBody } from '../component/CallRecording/CallRecordingBody';
import { CallSidePanelSections } from '../component/sidepanel/CallSidePanelSections';
import type { CallTranscriptTarget } from '../constants';

import { CallDetailMobileHeader } from './CallDetailMobileHeader';

export type CallDetailData = { record: CallRecord; name: string };

function callDetailName(record: CallRecord): string {
  return (
    record.customName ?? record.channelName ?? t('calls.detailFallbackName')
  );
}

/** Share the call query without owning either host's header. */
export function useCallDetail(callId: Accessor<string>) {
  const query = useCallRecordQuery(callId);
  usePending('call.record', () => query.isPending);

  const data = (): CallDetailData | undefined => {
    if (query.isPending) return undefined;
    const record = query.data;
    return record ? { record, name: callDetailName(record) } : undefined;
  };

  return { query, data };
}

export function CallDetailActions(props: {
  callId: string;
  record: CallRecord;
  name: string;
}) {
  const panel = useSplitPanelOrThrow();
  const sidePanel = useSidePanel();
  const openShare = useShareModal(() => ({
    id: props.callId,
    blockAlias: 'call',
    itemType: 'call',
    name: props.name,
    userPermissions: getPermissions(props.record.userAccessLevel ?? undefined),
    owner: props.record.createdBy,
  }));

  return (
    <div class="ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
      <SidePanel.HeaderActionsOutlet />
      <ShareTrigger
        onClick={openShare}
        id={props.callId}
        blockType="call"
        hotkeyScope={panel.splitHotkeyScope}
      />
      <Show when={!sidePanel?.isOpen() || sidePanel?.isOverlayMode()}>
        <SidePanel.Toggle />
      </Show>
    </div>
  );
}

/** Keep side-panel state alive across call-record query updates. */
export function CallDetailRoot(props: ParentProps<{ callId: string }>) {
  return (
    <SidePanel.Root persistKey={`call:${props.callId}`}>
      {props.children}
    </SidePanel.Root>
  );
}

function LoadedCallContent(props: {
  callId: string;
  record: CallRecord;
  transcriptTarget?: CallTranscriptTarget;
  messageId?: string;
  seek?: string;
  header?: () => JSX.Element;
}) {
  const [, setSearch] = createSearchParams(callDetailSearch);
  onMount(() => {
    optimisticUpdateSoupItemViewedAt(props.callId);
    if (!hasSoupEntity(props.callId)) {
      fireAndForget(refetchSoupEntity(props.callId, 'call'), 'call-detail');
    }
  });
  return (
    <>
      <CallSidePanelSections callId={props.callId} record={props.record} />
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <CallRecordingBody
          record={props.record}
          callId={props.callId}
          header={props.header}
          transcriptTarget={props.transcriptTarget}
          messageTarget={props.messageId}
          messageTargetRequestKey={props.seek}
          onClearMessageTarget={() =>
            setSearch({ messageId: undefined }, { history: 'replace' })
          }
        />
      </div>
    </>
  );
}

/** Both native hosts place their own top bar above this detail content. */
export function CallDetailContent(props: {
  callId: string;
  query: ReturnType<typeof useCallRecordQuery>;
  data?: CallDetailData;
  transcriptId?: string;
  messageId?: string;
  seek?: string;
  header?: () => JSX.Element;
}) {
  // Include the route's seek token so selecting the same segment re-runs the seek.
  const transcriptTarget = createMemo<CallTranscriptTarget | undefined>(() =>
    props.transcriptId
      ? { transcriptId: props.transcriptId, gen: 0, seek: props.seek }
      : undefined
  );
  return (
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <Show when={!props.data}>{props.header?.()}</Show>
      <Show
        when={props.data}
        fallback={
          <Switch>
            <Match when={props.query.status === 'pending'}>
              <div class="grid size-full place-items-center text-ink-muted touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                <SpinnerIcon
                  aria-hidden={false}
                  aria-label={t('calls.detailLoadingRecording')}
                  class="size-5 animate-spin"
                />
              </div>
            </Match>
            <Match when={props.query.status === 'error'}>
              <div class="grid size-full place-items-center text-ink-muted touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                <div class="flex flex-col items-center gap-3 text-sm">
                  <span>{t('calls.detailFailedRecording')}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      fireAndForget(props.query.refetch(), 'call-detail')
                    }
                  >
                    {t('calls.detailRetry')}
                  </Button>
                </div>
              </div>
            </Match>
          </Switch>
        }
      >
        {(data) => (
          <Suspense
            fallback={
              <div class="grid size-full place-items-center text-ink-muted touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                <SpinnerIcon
                  aria-hidden={false}
                  aria-label={t('calls.detailLoadingRecording')}
                  class="size-5 animate-spin"
                />
              </div>
            }
          >
            <LoadedCallContent
              callId={props.callId}
              record={data().record}
              transcriptTarget={transcriptTarget()}
              messageId={props.messageId}
              seek={props.seek}
              header={props.header}
            />
          </Suspense>
        )}
      </Show>
    </div>
  );
}

export function CallDetailView(props: {
  callId: string;
  transcriptId?: string;
  messageId?: string;
  seek?: string;
  header?: (data: Accessor<CallDetailData | undefined>) => JSX.Element;
}) {
  const detail = useCallDetail(() => props.callId);
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('call');
    analytics.track('open_entity', {
      entityType: 'call',
      entityId: props.callId,
    });
  });
  return (
    <CallDetailRoot callId={props.callId}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
        <Show when={isTouchDevice()}>
          <CallDetailMobileHeader callId={props.callId} data={detail.data()} />
        </Show>
        <CallDetailContent
          callId={props.callId}
          query={detail.query}
          data={detail.data()}
          transcriptId={props.transcriptId}
          messageId={props.messageId}
          seek={props.seek}
          header={() => (
            <Show when={!isTouchDevice()}>
              <ViewShell.TopBar>
                <Show
                  when={props.header}
                  fallback={
                    <>
                      <PhoneCallIcon class="size-4 shrink-0 text-ink-muted" />
                      <span class="min-w-0 truncate text-sm font-semibold">
                        {detail.data()?.name ?? t('calls.detailFallbackName')}
                      </span>
                    </>
                  }
                >
                  {(header) => (
                    <>
                      <div class="contents @max-[600px]/split-header:hidden">
                        {header()(detail.data)}
                      </div>
                      <div class="hidden min-w-0 items-center gap-1.5 @max-[600px]/split-header:flex">
                        <PhoneCallIcon class="size-4 shrink-0 text-ink-muted" />
                        <span class="truncate text-sm font-medium">
                          {detail.data()?.name ?? t('calls.detailFallbackName')}
                        </span>
                      </div>
                    </>
                  )}
                </Show>
                <Show when={detail.data()}>
                  {(data) => (
                    <CallDetailActions
                      callId={props.callId}
                      record={data().record}
                      name={data().name}
                    />
                  )}
                </Show>
              </ViewShell.TopBar>
            </Show>
          )}
        />
      </div>
    </CallDetailRoot>
  );
}
