import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { SortDropdown } from '@app/component/next-soup/soup-view/filters-bar/sort-dropdown';
import {
  SORT_OPTIONS,
  TASK_SORT_OPTIONS,
  type SortOption,
  type SystemSortOption,
} from '@app/component/next-soup/soup-view/sort-options';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { createMemo, Switch, Match } from 'solid-js';

export const SoupViewContextSort = () => {
  const panel = useSplitPanelOrThrow();

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  return (
    <Switch>
      <Match when={isComponentListView('inbox')}>
        <InboxSort />
      </Match>
      <Match when={isComponentListView('agents')}>
        <AgentsSort />
      </Match>
      <Match when={isComponentListView('mail')}>
        <MailSort />
      </Match>
      <Match when={isComponentListView('documents')}>
        <DocumentsSort />
      </Match>
      <Match when={isComponentListView('tasks')}>
        <TasksSort />
      </Match>
      <Match when={isComponentListView('channels')}>
        <ChannelsSort />
      </Match>
      <Match when={isComponentListView('files')}>
        <FilesSort />
      </Match>
    </Switch>
  );
};

const useSortDropdown = (options: SortOption[] = SORT_OPTIONS) => {
  const { soup } = useSoupView();

  const value = createMemo(
    () => (soup.sort.active()[0]?.id as SystemSortOption) ?? 'updated_at'
  );

  const onChange = (sortOption: SystemSortOption) => {
    soup.sort.setAll([sortOption]);
  };

  return { value, onChange, options };
};

const InboxSort = () => {
  const sort = useSortDropdown();

  return (
    <SortDropdown
      value={sort.value}
      onChange={sort.onChange}
      options={sort.options}
    />
  );
};

const AgentsSort = () => {
  const sort = useSortDropdown();

  return (
    <SortDropdown
      value={sort.value}
      onChange={sort.onChange}
      options={sort.options}
    />
  );
};

const MailSort = () => {
  const sort = useSortDropdown();

  return (
    <SortDropdown
      value={sort.value}
      onChange={sort.onChange}
      options={sort.options}
    />
  );
};

const DocumentsSort = () => {
  const sort = useSortDropdown();

  return (
    <SortDropdown
      value={sort.value}
      onChange={sort.onChange}
      options={sort.options}
    />
  );
};

const TasksSort = () => {
  const sort = useSortDropdown(TASK_SORT_OPTIONS);

  return (
    <SortDropdown
      value={sort.value}
      onChange={sort.onChange}
      options={sort.options}
    />
  );
};

const ChannelsSort = () => {
  const sort = useSortDropdown();

  return (
    <SortDropdown
      value={sort.value}
      onChange={sort.onChange}
      options={sort.options}
    />
  );
};

const FilesSort = () => {
  const sort = useSortDropdown();

  return (
    <SortDropdown
      value={sort.value}
      onChange={sort.onChange}
      options={sort.options}
    />
  );
};
