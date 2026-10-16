import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { enableCrmActivity } from '@core/constant/featureFlags';
import type { JSX } from 'solid-js';
import {
  CRM_ACTIVITY_TABS,
  CRM_RECORDS,
  pipelineTab,
} from '../core/navigation';

export function CrmMobileTabs(props: {
  active: string;
  pipelines: readonly { id: string; name: string }[];
  lists: readonly { id: string; name: string }[];
  leading?: JSX.Element;
  onNavigate(id: string): void;
}) {
  const activityFlag = useFeatureFlag(enableCrmActivity);
  const items = (): PillTabItem[] => [
    ...[
      ...CRM_RECORDS,
      ...(activityFlag().enabled ? CRM_ACTIVITY_TABS : []),
    ].map((record) => ({
      value: record.id,
      label: record.label,
    })),
    ...props.pipelines.map((pipeline) => ({
      value: pipelineTab(pipeline.id),
      label: pipeline.name,
    })),
    ...props.lists.map((list) => ({
      value: `list:${list.id}`,
      label: list.name,
    })),
  ];

  return (
    <nav aria-label="CRM views" class="flex h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={props.leading}
        items={items()}
        value={props.active}
        onChange={props.onNavigate}
      />
    </nav>
  );
}
