import type { ListView } from '@app/constants/list-views';
import { GroupDropdown } from '@app/features/next-soup/soup-view/filters-bar/group-dropdown';
import {
  COMPANY_GROUP_OPTIONS,
  type GroupOptionId,
  TAG_VIEW_GROUP_OPTIONS,
  TASK_GROUP_OPTIONS,
} from '@app/features/next-soup/soup-view/group-options';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { enableSoupGroupBy } from '@core/constant/featureFlags';
import { createMemo, createSignal, Show } from 'solid-js';

export const SoupViewContextGroup = (props: { hideLabel?: boolean }) => {
  const panel = useSplitPanelOrThrow();
  const { soup, viewMode } = useSoupView();
  const groupByEnabled = useFeatureFlag(enableSoupGroupBy);

  const [groupOpen, setGroupOpen] = createSignal(false);

  const component = createMemo(() => {
    const content = panel.handle.content();
    if (content.type !== 'component') return;
    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  const value = createMemo(
    (): GroupOptionId =>
      (soup.grouping.activeGroupId() as GroupOptionId) ?? 'none'
  );

  const onChange = (groupOption: GroupOptionId) => {
    if (groupOption === 'none') {
      soup.grouping.setActiveGroupId(undefined);
    } else {
      soup.grouping.setActiveGroupId(groupOption);
      soup.grouping.expandAll();
    }
  };

  return (
    <Show when={groupByEnabled().enabled}>
      <Show when={isComponentListView('tasks')}>
        <GroupDropdown
          value={value}
          onChange={onChange}
          options={TASK_GROUP_OPTIONS}
          open={groupOpen()}
          onOpenChange={setGroupOpen}
          hideLabel={props.hideLabel}
        />
      </Show>
      {/* The board is inherently grouped by stage columns, so grouping only
          applies to the list mode. */}
      <Show when={isComponentListView('companies') && viewMode() === 'list'}>
        <GroupDropdown
          value={value}
          onChange={onChange}
          options={COMPANY_GROUP_OPTIONS}
          open={groupOpen()}
          onOpenChange={setGroupOpen}
          hideLabel={props.hideLabel}
        />
      </Show>
      <Show when={component() === 'tag'}>
        <GroupDropdown
          value={value}
          onChange={onChange}
          options={TAG_VIEW_GROUP_OPTIONS}
          open={groupOpen()}
          onOpenChange={setGroupOpen}
          hideLabel={props.hideLabel}
        />
      </Show>
    </Show>
  );
};
