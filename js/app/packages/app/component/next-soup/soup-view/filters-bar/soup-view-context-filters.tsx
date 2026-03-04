import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { createMemo, Match, Show, Switch } from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  AssigneeFilter,
  ChannelVisibilityFilter,
  DocumentLocationFilter,
  DocumentTypeFilter,
  EmailDoneStatusFilter,
  EmailReadStatusFilter,
  EntityTypeFilter,
  FileTypeFilter,
  ProjectFilter,
  TaskPriorityFilter,
  TaskStatusFilter,
} from './filter-controls';

export const SoupViewContextFilters = () => {
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
    <div class="h-full flex items-center gap-1.5">
      <Switch>
        <Match when={isComponentListView('inbox')}>
          <InboxFilters />
        </Match>
        <Match when={isComponentListView('agents')}>
          <AgentsFilters />
        </Match>
        <Match when={isComponentListView('mail')}>
          <MailFilters />
        </Match>
        <Match when={isComponentListView('documents')}>
          <DocumentsFilters />
        </Match>
        <Match when={isComponentListView('tasks')}>
          <TasksFilters />
        </Match>
        <Match when={isComponentListView('channels')}>
          <ChannelsFilters />
        </Match>
        <Match when={isComponentListView('files')}>
          <FilesFilters />
        </Match>
      </Switch>
    </div>
  );
};

const InboxFilters = () => {
  return <EntityTypeFilter />;
};

const AgentsFilters = () => {
  return <ProjectFilter />;
};

const MailFilters = () => {
  return (
    <>
      <EmailReadStatusFilter />
      <EmailDoneStatusFilter />
    </>
  );
};

const DocumentsFilters = () => {
  return (
    <>
      <DocumentTypeFilter />
      <DocumentLocationFilter />
    </>
  );
};

const TasksFilters = () => {
  const { soup } = useSoupView();

  return (
    <>
      <TaskStatusFilter />
      <TaskPriorityFilter />
      <Show when={!soup.filters.isActive('assigned-to')}>
        <AssigneeFilter />
      </Show>
    </>
  );
};

const ChannelsFilters = () => {
  return <ChannelVisibilityFilter />;
};

const FilesFilters = () => {
  return <FileTypeFilter />;
};
