import { createSearchParams } from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  type CallBlockProps,
  type CallTranscriptTarget,
  URL_PARAMS,
} from '@block-call/constants';
import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { useCallRecordQuery } from '@queries/call/call';
import { useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, on, Show } from 'solid-js';
import { callDetailSearch } from '../call-route';
import { CallRecordingBody } from './CallRecording/CallRecordingBody';
import { CallRecordingSplitHeader } from './CallRecording/CallRecordingSplitHeader';
import { CallSidePanelSections } from './sidepanel/CallSidePanelSections';

export function CallBlockAdapter(props: CallBlockProps) {
  const callId = useBlockId();
  const callRecord = useCallRecordQuery(() => callId);
  const blockHandle = blockHandleSignal.get;
  const [searchParams] = useSearchParams();
  const [routeSearch, setRouteSearch] = createSearchParams(callDetailSearch);

  const initialTranscriptId = ((): string | undefined => {
    if (routeSearch.transcriptId) return routeSearch.transcriptId;
    const fromProps = props[URL_PARAMS.transcriptId];
    if (fromProps) return fromProps;
    const isSingleSplit = globalSplitManager()?.splits().length === 1;
    if (!isSingleSplit) return undefined;
    return searchParams[URL_PARAMS.transcriptId] as string | undefined;
  })();

  const [transcriptTarget, setTranscriptTarget] = createSignal<
    CallTranscriptTarget | undefined
  >(
    initialTranscriptId
      ? { transcriptId: initialTranscriptId, gen: 0 }
      : undefined
  );
  const initialMessageId = ((): string | undefined => {
    if (routeSearch.messageId) return routeSearch.messageId;
    const fromProps = props[URL_PARAMS.messageId];
    if (fromProps) return fromProps;
    if (globalSplitManager()?.splits().length !== 1) return undefined;
    const fromSearch = searchParams[URL_PARAMS.messageId];
    return typeof fromSearch === 'string' ? fromSearch : undefined;
  })();
  const [messageTarget, setMessageTarget] = createSignal<
    { id: string; requestKey: number } | undefined
  >(initialMessageId ? { id: initialMessageId, requestKey: 0 } : undefined);
  const requestMessageTarget = (id: string | undefined) =>
    setMessageTarget((previous) =>
      id ? { id, requestKey: (previous?.requestKey ?? 0) + 1 } : undefined
    );
  let routeOwnsMessageTarget = Boolean(routeSearch.messageId);
  createEffect(
    on(
      () => [routeSearch.messageId, routeSearch.seek],
      () => {
        if (!routeSearch.messageId) {
          if (routeOwnsMessageTarget) {
            routeOwnsMessageTarget = false;
            setMessageTarget(undefined);
          }
          return;
        }
        routeOwnsMessageTarget = true;
        requestMessageTarget(routeSearch.messageId);
      },
      { defer: true }
    )
  );

  const clearMessageTarget = () => {
    setMessageTarget(undefined);
    if (!routeOwnsMessageTarget) return;
    routeOwnsMessageTarget = false;
    setRouteSearch({ messageId: undefined }, { history: 'replace' });
  };

  let routeOwnsTarget = Boolean(routeSearch.transcriptId);
  createEffect(
    on(
      () => [routeSearch.transcriptId, routeSearch.seek],
      () => {
        if (!routeSearch.transcriptId) {
          if (routeOwnsTarget) {
            routeOwnsTarget = false;
            setTranscriptTarget(undefined);
          }
          return;
        }
        routeOwnsTarget = true;
        setTranscriptTarget((previous) => ({
          transcriptId: routeSearch.transcriptId,
          gen: (previous?.gen ?? 0) + 1,
        }));
      },
      { defer: true }
    )
  );

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: CallBlockProps) => {
      const messageId = params[URL_PARAMS.messageId];
      routeOwnsMessageTarget = false;
      requestMessageTarget(messageId);
      const next = params[URL_PARAMS.transcriptId];
      if (!next) return;
      routeOwnsTarget = false;
      setTranscriptTarget((prev) => ({
        transcriptId: next,
        gen: (prev?.gen ?? 0) + 1,
      }));
    },
  });

  // Loading / Unauthorized / not-found / error are rendered by
  // DocumentBlockContainer from the block loader's result (like every other
  // block). load() primes the record query, so callRecord.data is present
  // whenever the container renders this content.
  return (
    <DocumentBlockContainer>
      <div class="h-full flex flex-col @container">
        <Show when={callRecord.isPending ? undefined : callRecord.data}>
          {(data) => (
            <SidePanel.Layout floating>
              <CallSidePanelSections record={data()} callId={callId} />
              <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
                <CallRecordingSplitHeader record={data()} />
                <CallRecordingBody
                  record={data()}
                  callId={callId}
                  transcriptTarget={transcriptTarget()}
                  messageTarget={messageTarget()?.id}
                  messageTargetRequestKey={messageTarget()?.requestKey}
                  onClearMessageTarget={clearMessageTarget}
                  showOverlayHeaderGap
                />
              </div>
            </SidePanel.Layout>
          )}
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
