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
  const [routeSearch] = createSearchParams(callDetailSearch);

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

  createEffect(
    on(
      () => [routeSearch.transcriptId, routeSearch.seek],
      () => {
        if (!routeSearch.transcriptId) {
          setTranscriptTarget(undefined);
          return;
        }
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
      const next = params[URL_PARAMS.transcriptId];
      if (!next) return;
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
            <SidePanel.Layout>
              <CallSidePanelSections record={data()} callId={callId} />
              <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
                <CallRecordingSplitHeader record={data()} />
                <CallRecordingBody
                  record={data()}
                  callId={callId}
                  transcriptTarget={transcriptTarget()}
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
