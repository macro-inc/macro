import { ViewShell } from '@app/components/view-shell';
import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { isMobile } from '@core/mobile/isMobile';
import PhoneCallIcon from '@phosphor/phone-call.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
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
  Match,
  onMount,
  type ParentProps,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { CallRecordingBody } from '../component/CallRecording/CallRecordingBody';
import { CallSidePanelSections } from '../component/sidepanel/CallSidePanelSections';
import { useCallAgain } from '../component/use-call-again';
import type { CallTranscriptTarget } from '../constants';

export type CallDetailData = { record: CallRecord; name: string };

function callDetailName(record: CallRecord): string {
  return record.customName ?? record.channelName ?? 'Call Recording';
}

/** Share the call query without owning either host's header. */
export function useCallDetail(callId: Accessor<string>) {
  const query = useCallRecordQuery(callId);

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
  const { canCallAgain, callAgain } = useCallAgain(
    () => props.callId,
    () => props.record.channelId
  );
  const openShare = useShareModal(() => ({
    id: props.callId,
    blockAlias: 'call',
    itemType: 'call',
    name: props.name,
    userPermissions: getPermissions(props.record.userAccessLevel ?? undefined),
    owner: props.record.createdBy,
  }));

  return (
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <Show when={!isMobile() && !props.record.isActive && canCallAgain()}>
        <Button variant="outline" size="sm" onClick={callAgain}>
          <PhoneCallIcon class="size-4" />
          Call Again
        </Button>
      </Show>
      <ChatWithAgentButton
        entity={{
          type: 'document',
          id: props.callId,
          name: props.name,
          fileType: 'call',
        }}
      />
      <ShareTrigger
        onClick={openShare}
        id={props.callId}
        blockType="call"
        hotkeyScope={panel.splitHotkeyScope}
      />
      <SidePanel.Toggle />
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
}) {
  onMount(() => {
    optimisticUpdateSoupItemViewedAt(props.callId);
    if (!hasSoupEntity(props.callId)) {
      void refetchSoupEntity(props.callId, 'call');
    }
  });
  return (
    <SidePanel.Layout headerToggle={false}>
      <CallSidePanelSections callId={props.callId} record={props.record} />
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <CallRecordingBody
          record={props.record}
          callId={props.callId}
          transcriptTarget={props.transcriptTarget}
        />
      </div>
    </SidePanel.Layout>
  );
}

/** Both native hosts place their own top bar above this detail content. */
export function CallDetailContent(props: {
  callId: string;
  query: ReturnType<typeof useCallRecordQuery>;
  data?: CallDetailData;
  transcriptId?: string;
  seek?: string;
}) {
  // Include the route's seek token so selecting the same segment re-runs the seek.
  const transcriptTarget = createMemo<CallTranscriptTarget | undefined>(() =>
    props.transcriptId
      ? { transcriptId: props.transcriptId, gen: 0, seek: props.seek }
      : undefined
  );
  return (
    <div class="relative min-h-0 min-w-0 flex-1">
      <Show
        when={props.data}
        fallback={
          <Switch>
            <Match when={props.query.status === 'pending'}>
              <div class="grid size-full place-items-center text-ink-muted">
                <SpinnerIcon
                  aria-label="Loading call recording"
                  class="size-5 animate-spin"
                />
              </div>
            </Match>
            <Match when={props.query.status === 'error'}>
              <div class="grid size-full place-items-center text-ink-muted">
                <div class="flex flex-col items-center gap-3 text-sm">
                  <span>This call recording could not be displayed.</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void props.query.refetch()}
                  >
                    Retry
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
              <div class="grid size-full place-items-center text-ink-muted">
                <SpinnerIcon
                  aria-label="Loading call recording"
                  class="size-5 animate-spin"
                />
              </div>
            }
          >
            <LoadedCallContent
              callId={props.callId}
              record={data().record}
              transcriptTarget={transcriptTarget()}
            />
          </Suspense>
        )}
      </Show>
    </div>
  );
}

export function StandaloneCallDetail(props: {
  callId: string;
  transcriptId?: string;
  seek?: string;
}) {
  const detail = useCallDetail(() => props.callId);
  return (
    <CallDetailRoot callId={props.callId}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
        <ViewShell.TopBar class="touch:flex">
          <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
          <PhoneCallIcon class="size-4 shrink-0 text-ink-muted" />
          <span class="min-w-0 truncate text-sm font-semibold">
            {detail.data()?.name ?? 'Call Recording'}
          </span>
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
        <CallDetailContent
          callId={props.callId}
          query={detail.query}
          data={detail.data()}
          transcriptId={props.transcriptId}
          seek={props.seek}
        />
      </div>
    </CallDetailRoot>
  );
}
