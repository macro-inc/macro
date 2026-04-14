import { useBlockId } from '@core/block';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { MaybeResultError } from '@core/util/maybeResult';
import { useCallRecordQuery } from '@queries/call/call';
import { Match, Show, Switch } from 'solid-js';
import { CallTranscript } from './CallTranscript';

function isUnauthorized(error: Error | null): boolean {
  if (error instanceof MaybeResultError) {
    return error.errors[0]?.code === 'UNAUTHORIZED';
  }
  return false;
}

export function CallBlockAdapter() {
  const callId = useBlockId();
  const callRecord = useCallRecordQuery(() => callId);

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <div class="px-4 py-3 border-b border-edge shrink-0">
        <h2 class="text-sm font-medium text-ink">Call Recording</h2>
      </div>
      <div class="flex-1 overflow-y-auto">
        <Switch>
          <Match when={callRecord.isLoading}>
            <div class="flex items-center justify-center h-full text-ink-faint text-sm">
              Loading call...
            </div>
          </Match>
          <Match when={callRecord.isError && isUnauthorized(callRecord.error)}>
            <Unauthorized />
          </Match>
          <Match when={callRecord.isError}>
            <div class="flex items-center justify-center h-full text-failure text-sm">
              Failed to load call recording.
            </div>
          </Match>
          <Match when={callRecord.data}>
            {(data) => (
              <>
                <Show when={data().recordingUrl}>
                  {(url) => (
                    <div class="p-4 border-b border-edge flex justify-center">
                      <video
                        class="w-3/4 rounded"
                        controls
                        crossorigin="anonymous"
                        src={url()}
                      />
                    </div>
                  )}
                </Show>
                <Show
                  when={data().transcript.length > 0}
                  fallback={
                    <Show when={!data().recordingUrl}>
                      <div class="flex items-center justify-center h-full text-ink-faint text-sm">
                        No recording or transcript available.
                      </div>
                    </Show>
                  }
                >
                  <CallTranscript transcript={data().transcript} />
                </Show>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  );
}
