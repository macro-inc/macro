import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import PhoneCallIcon from '@macro-icons/wide/call.svg';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { Accessor } from 'solid-js';

export function CallRecordingSplitHeaderLoading() {
  return (
    <SplitHeaderLeft>
      <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
        <div class="ph-no-capture z-3 relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
          <StaticSplitLabel
            label="Call Recording"
            icon={
              <PhoneCallIcon class="size-4 touch:size-6 shrink-0 text-ink-muted" />
            }
          />
        </div>
      </div>
    </SplitHeaderLeft>
  );
}

export function CallRecordingSplitHeader(props: {
  record: Accessor<CallRecord>;
}) {
  const record = props.record;
  return (
    <SplitHeaderLeft>
      <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
        <div class="ph-no-capture z-3 relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
          <StaticSplitLabel
            label={record().channelName ?? 'Call'}
            icon={
              <PhoneCallIcon class="size-4 touch:size-6 shrink-0 text-ink-muted" />
            }
          />
        </div>
      </div>
    </SplitHeaderLeft>
  );
}
