import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { createMemo, Match, Show, Switch } from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  AssigneeFilter,
  ChannelVisibilityFilter,
  DocumentFolderFilter,
  DocumentTypeFilter,
  DoneStatusFilter,
  EntityTypeFilter,
  FileTypeFilter,
  FoldersFilter,
  FromSenderFilter,
  HasAttachmentFilter,
  HasCalendarInviteFilter,
  ProjectFilter,
  ReadStatusFilter,
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
  const { activeTab } = useSoupView();

  const isDraftsTab = () => activeTab() === 'drafts';
  const isSentTab = () => activeTab() === 'sent';

  return (
    <>
      {/* Hide read/done status on drafts tab */}
      <Show when={!isDraftsTab()}>
        <ReadStatusFilter />
        <DoneStatusFilter />
      </Show>
      {/* Hide FromSender on sent tab (already filtered to current user) */}
      <Show when={!isSentTab()}>
        <FromSenderFilter />
      </Show>
      <HasAttachmentFilter />
      <HasCalendarInviteFilter />
    </>
  );
};

const DocumentsFilters = () => {
  return (
    <>
      <DocumentTypeFilter />
      <DocumentFolderFilter />
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
  return (
    <>
      <FoldersFilter />
      <FileTypeFilter />
    </>
  );
};
