import { TextButton } from '@core/component/TextButton';
import { EDITABLE_SMART_INSIGHTS } from '@core/constant/featureFlags';
import { formatDate } from '@core/util/date';
import Flag from '@icon/regular/flag-pennant.svg';
import Pencil from '@icon/regular/pencil-simple.svg';
import type { UserInsightRecord } from '@service-insight/generated/schemas/userInsightRecord';
import { createMemo, Show } from 'solid-js';

export type SmartInsightProps = {
  insight: UserInsightRecord;
};

export function SmartInsight(props: SmartInsightProps) {
  const prettyDate = createMemo(() => formatDate(props.insight.updatedAt));

  return (
    <div class="text-sm py-1">
      <div class="flex flex-row justify-between gap-x-2 items-center">
        <div class="flex items-center flex-1">{props.insight.content}</div>
        <div class="flex flex-row">
          <div class="text-xs items-center gap-x-1 px-1 flex text-ink-extra-muted">
            Generated
            <div class="px-1">{prettyDate()}</div>
          </div>
          <Show when={EDITABLE_SMART_INSIGHTS}>
            <TextButton
              onClick={() => {}}
              icon={Flag}
              text="Mark Wrong"
              theme="red"
            />
            <TextButton
              onClick={() => {}}
              icon={Pencil}
              text="Suggest Improvement"
              theme="accent"
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
