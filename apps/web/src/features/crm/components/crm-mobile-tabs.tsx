import { t } from '@app/lib/i18n';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import type { JSX } from 'solid-js';
import {
  CRM_ACTIVITY_TABS,
  CRM_RECORDS,
  pipelineTab,
} from '../core/navigation';

export function CrmMobileTabs(props: {
  active: string;
  /** Keep destinations visible until access is proven denied. */
  canAccess: boolean;
  pipelines: readonly { id: string; name: string }[];
  lists: readonly { id: string; name: string }[];
  leading?: JSX.Element;
  onNavigate(id: string): void;
}) {
  const items = (): PillTabItem[] => [
    ...[
      ...(props.canAccess ? CRM_RECORDS : []),
      ...(props.canAccess ? CRM_ACTIVITY_TABS : []),
    ].map((record) => ({
      value: record.id,
      label: record.label,
    })),
    ...props.pipelines.map((pipeline) => ({
      value: pipelineTab(pipeline.id),
      label: pipeline.name,
    })),
    ...(props.canAccess ? props.lists : []).map((list) => ({
      value: `list:${list.id}`,
      label: list.name,
    })),
  ];

  return (
    <nav aria-label={t('crm.viewsNavigation')} class="flex h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) min-w-0 flex-1"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={props.leading}
        items={items()}
        value={props.active}
        onChange={props.onNavigate}
      />
    </nav>
  );
}
