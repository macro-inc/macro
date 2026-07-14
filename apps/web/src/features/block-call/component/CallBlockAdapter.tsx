import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS } from '@block-call/constants';
import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { useCallRecordQuery } from '@queries/call/call';
import { useSearchParams } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { CallRecordingBody } from './CallRecording/CallRecordingBody';
import { ModalsProvider } from './ModalsProvider';
import { CallSidePanelSections } from './sidepanel/CallSidePanelSections';

export type CallBlockProps = {
  [URL_PARAMS.transcriptId]?: string;
};

export type CallTranscriptTarget = { transcriptId: string; gen: number };

export function CallBlockAdapter(props: CallBlockProps) {
  const callId = useBlockId();
  const callRecord = useCallRecordQuery(() => callId);
  const blockHandle = blockHandleSignal.get;
  const [searchParams] = useSearchParams();

  const initialTranscriptId = ((): string | undefined => {
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
        <ModalsProvider>
          <Show when={callRecord.data}>
            {(data) => (
              <SidePanel.Layout>
                <CallSidePanelSections record={data} />
                <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
                  <CallRecordingBody
                    data={data}
                    transcriptTarget={transcriptTarget}
                  />
                </div>
              </SidePanel.Layout>
            )}
          </Show>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}
