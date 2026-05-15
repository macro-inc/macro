import { GroupDropdown } from '@app/component/next-soup/soup-view/filters-bar/group-dropdown';
import {
  type GroupOptionId,
  TASK_GROUP_OPTIONS,
} from '@app/component/next-soup/soup-view/group-options';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { ENABLE_SOUP_GROUP_BY_OVERRIDE } from '@core/constant/featureFlags';
import { createMemo, createSignal, Show } from 'solid-js';

export const SoupViewContextGroup = () => {
  const panel = useSplitPanelOrThrow();
  const { soup } = useSoupView();
  const groupByEnabled = useFeatureFlag('enable-soup-group-by', {
    enabledOverride: ENABLE_SOUP_GROUP_BY_OVERRIDE,
  });

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
        />
      </Show>
    </Show>
  );
};
