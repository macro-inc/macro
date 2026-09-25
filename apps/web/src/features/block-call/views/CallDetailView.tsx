import { ViewShell } from '@app/components/view-shell';
import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { createSearchParams } from '@app/lib/split-router';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { getPermissions } from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareModal,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
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
  createEffect,
  createSignal,
  Match,
  on,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { callDetailSearch } from '../call-route';
import { CallRecordingBody } from '../component/CallRecording/CallRecordingBody';
import { CallSidePanelSections } from '../component/sidepanel/CallSidePanelSections';
import { useCallAgain } from '../component/use-call-again';
import type { CallTranscriptTarget } from '../constants';

function CallDetailContent(props: {
  callId: string;
  record: Accessor<CallRecord>;
  transcriptTarget: Accessor<CallTranscriptTarget | undefined>;
}) {
  const panel = useSplitPanelOrThrow();
  const [shareOpen, setShareOpen] = createSignal(false);
  const { canCallAgain, callAgain } = useCallAgain(
    () => props.callId,
    () => props.record().channelId
  );
  const callName = () =>
    props.record().customName ?? props.record().channelName ?? 'Call Recording';

  onMount(() => {
    optimisticUpdateSoupItemViewedAt(props.callId);
    if (!hasSoupEntity(props.callId)) {
      void refetchSoupEntity(props.callId, 'call');
    }
  });

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <SidePanel.Layout
        persistKey={`call:${props.callId}`}
        headerToggle={false}
      >
        <CallSidePanelSections callId={props.callId} record={props.record} />
        <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
          <ViewShell.TopBar class="touch:flex">
            <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
            <PhoneCallIcon class="size-4 shrink-0 text-ink-muted" />
            <span class="min-w-0 truncate text-sm font-semibold">
              {callName()}
            </span>
            <div class="ml-auto flex shrink-0 items-center gap-2">
              <Show
                when={!isMobile() && !props.record().isActive && canCallAgain()}
              >
                <Button variant="outline" size="sm" onClick={callAgain}>
                  <PhoneCallIcon class="size-4" />
                  Call Again
                </Button>
              </Show>
              <ChatWithAgentButton
                entity={{
                  type: 'document',
                  id: props.callId,
                  name: callName(),
                  fileType: 'call',
                }}
              />
              <ShareTrigger
                id={props.callId}
                blockType="call"
                hotkeyScope={panel.splitHotkeyScope}
              />
              <SidePanel.Toggle />
            </div>
          </ViewShell.TopBar>
          <CallRecordingBody
            data={props.record}
            callId={props.callId}
            transcriptTarget={props.transcriptTarget}
          />
        </div>
      </SidePanel.Layout>
      <Suspense>
        <ShareModal
          isSharePermOpen={shareOpen()}
          setIsSharePermOpen={setShareOpen}
          id={props.callId}
          blockAlias="call"
          itemType="call"
          name={callName()}
          userPermissions={getPermissions(
            props.record().userAccessLevel ?? undefined
          )}
          owner={props.record().createdBy}
        />
      </Suspense>
    </ShareDialogContext.Provider>
  );
}

export function CallDetailView(props: { callId: string }) {
  const callRecord = useCallRecordQuery(() => props.callId);
  const [searchParams] = createSearchParams(callDetailSearch);
  const initialTranscriptId = searchParams.transcriptId;
  const [transcriptTarget, setTranscriptTarget] = createSignal<
    CallTranscriptTarget | undefined
  >(
    initialTranscriptId
      ? { transcriptId: initialTranscriptId, gen: 0 }
      : undefined
  );
  const navigateToTranscript = (transcriptId: string) => {
    if (!transcriptId) return;
    setTranscriptTarget((previous) => ({
      transcriptId,
      gen: (previous?.gen ?? 0) + 1,
    }));
  };

  // Seek again when the same transcript is selected from another list result.
  createEffect(
    on(
      () => [searchParams.transcriptId, searchParams.seek] as const,
      ([id]) => {
        if (id) navigateToTranscript(id);
      },
      { defer: true }
    )
  );

  return (
    <Switch>
      <Match when={callRecord.isLoading}>
        <div class="grid size-full place-items-center text-ink-muted">
          <SpinnerIcon
            aria-label="Loading call recording"
            class="size-5 animate-spin"
          />
        </div>
      </Match>
      <Match when={callRecord.isError}>
        <div class="grid size-full place-items-center text-ink-muted">
          <div class="flex flex-col items-center gap-3 text-sm">
            <span>This call recording could not be displayed.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void callRecord.refetch()}
            >
              Retry
            </Button>
          </div>
        </div>
      </Match>
      <Match when={callRecord.isSuccess ? callRecord.data : undefined}>
        {(record) => (
          <CallDetailContent
            callId={props.callId}
            record={record}
            transcriptTarget={transcriptTarget}
          />
        )}
      </Match>
    </Switch>
  );
}
