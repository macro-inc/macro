import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS } from '@block-call/constants';
import { useBlockId } from '@core/block';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { ThrownResultError } from '@core/util/result';
import { useCallRecordQuery } from '@queries/call/call';
import { useSearchParams } from '@solidjs/router';
import { createSignal, Match, Switch } from 'solid-js';
import { CallRecordingBody } from './CallRecording/CallRecordingBody';
import { CallRecordingSplitHeaderLoading } from './CallRecording/CallRecordingSplitHeader';
import { ModalsProvider } from './ModalsProvider';

function isUnauthorized(error: Error | null): boolean {
  if (error instanceof ThrownResultError) {
    return error.errors[0]?.code === 'UNAUTHORIZED';
  }
  return false;
}

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

  return (
    <ModalsProvider>
      <div class="h-full flex flex-col @container">
        <Switch>
          <Match when={callRecord.data}>
            {(data) => (
              <CallRecordingBody
                data={data}
                transcriptTarget={transcriptTarget}
              />
            )}
          </Match>
          <Match when={callRecord.isLoading}>
            <CallRecordingSplitHeaderLoading />
            <div class="flex flex-1 min-h-0 items-center justify-center text-sm text-ink-faint">
              Loading call...
            </div>
          </Match>
          <Match when={callRecord.isError && isUnauthorized(callRecord.error)}>
            <CallRecordingSplitHeaderLoading />
            <div class="flex flex-1 min-h-0 overflow-hidden">
              <Unauthorized />
            </div>
          </Match>
          <Match when={callRecord.isError}>
            <CallRecordingSplitHeaderLoading />
            <div class="flex flex-1 min-h-0 items-center justify-center text-sm text-failure">
              Failed to load call recording.
            </div>
          </Match>
        </Switch>
      </div>
    </ModalsProvider>
  );
}
