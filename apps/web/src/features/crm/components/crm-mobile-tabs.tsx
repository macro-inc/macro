import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import type { JSX } from 'solid-js';
import { CRM_RECORDS } from '../core/navigation';

export function CrmMobileTabs(props: {
  active: string;
  pipelines: readonly { id: string; name: string }[];
  lists: readonly { id: string; name: string }[];
  leading?: JSX.Element;
  onNavigate(id: string): void;
}) {
  const items = (): PillTabItem[] => [
    ...CRM_RECORDS.map((record) => ({
      value: record.id,
      label: record.label,
    })),
    ...props.pipelines.map((pipeline) => ({
      value: `pipeline:${pipeline.id}`,
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
