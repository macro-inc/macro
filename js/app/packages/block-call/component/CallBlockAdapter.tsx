import { useBlockId } from '@core/block';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { MaybeResultError } from '@core/util/maybeResult';
import { useCallRecordQuery } from '@queries/call/call';
import { Match, Switch } from 'solid-js';
import { CallRecordingBody } from './CallRecording/CallRecordingBody';
import { CallRecordingSplitHeaderLoading } from './CallRecording/CallRecordingSplitHeader';

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
    <div class="h-full flex flex-col @container">
      <Switch>
        <Match when={callRecord.data}>
          {(data) => <CallRecordingBody data={data} />}
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
  );
}
