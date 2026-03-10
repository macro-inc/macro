import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { createMemo, Match, Show, Switch } from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  AssigneeFilter,
  AttachmentTypeFilter,
  DocumentFolderFilter,
  DocumentTypeFilter,
  EntityTypeFilter,
  FileTypeFilter,
  FoldersFilter,
  FromSenderFilter,
  HasAttachmentFilter,
  HasCalendarInviteFilter,
  ProjectFilter,
  StatusFilter,
  TaskPriorityFilter,
  TaskStatusFilter,
} from './filter-controls';

const FilterDivider = () => (
  <div class="flex items-center self-stretch mx-1">
    <div class="w-px h-full bg-edge-muted/50" />
  </div>
);

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
  );
};

const InboxFilters = () => {
  return <EntityTypeFilter />;
};

const AgentsFilters = () => {
  return <ProjectFilter />;
};

const MailFilters = () => {
  const { activeTab, soup } = useSoupView();

  const isDraftsTab = () => activeTab() === 'drafts';
  const isSentTab = () => activeTab() === 'sent';
  const hasAttachmentActive = () => soup.filters.isActive('has-attachment');

  return (
    <>
      <Show when={!isDraftsTab()}>
        <StatusFilter />
      </Show>

      <Show when={!isSentTab() && !isDraftsTab()}>
        <FromSenderFilter />
        <FilterDivider />
      </Show>

      <HasAttachmentFilter />

      <Show when={hasAttachmentActive()}>
        <AttachmentTypeFilter />
      </Show>

      <HasCalendarInviteFilter />
    </>
  );
};

const DocumentsFilters = () => {
  return (
    <>
      <DocumentTypeFilter />
      <FilterDivider />
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
        <FilterDivider />
        <AssigneeFilter />
      </Show>
    </>
  );
};

const ChannelsFilters = () => {
  // No channels filters for now
  // TODO: Add channel filters
  return null;
};

const FilesFilters = () => {
  return (
    <>
      <FoldersFilter />
      <FilterDivider />
      <FileTypeFilter />
    </>
  );
};
