import { runCreateAction } from '@app/component/Launcher';
import { DOCS_BASE } from '@app/constants/docs-links';
import type { ListView } from '@app/constants/list-views';
import type { BlockAlias, BlockName } from '@core/block';
import { useAddInboxFlow, useEmailLinksStatus } from '@core/email-link';
import EmptyStateAiIcon from '@design/empty-state-ai.svg';
import EmptyStateAutomationsIcon from '@design/empty-state-automations.svg';
import EmptyStateCallsIcon from '@design/empty-state-calls.svg';
import EmptyStateChannelsIcon from '@design/empty-state-channels.svg';
import EmptyStateCompaniesIcon from '@design/empty-state-companies.svg';
import EmptyStateDocIcon from '@design/empty-state-doc.svg';
import EmptyStateEmailIcon from '@design/empty-state-email.svg';
import EmptyStateFolderIcon from '@design/empty-state-folder.svg';
import EmptyStateInboxTrayIcon from '@design/empty-state-inbox-tray.svg';
import EmptyStateInboxZeroIcon from '@design/empty-state-inbox-zero.svg';
import EmptyStateNoFilterMatchIcon from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchIcon from '@design/empty-state-no-search-match.svg';
import EmptyStateTasksIcon from '@design/empty-state-tasks.svg';
import PlusIcon from '@phosphor/plus.svg';
import { EmptyStatePanel, FilteredHiddenBanner } from '@ui';
import { type Component, type JSXElement, Match, Switch } from 'solid-js';
import { FolderDropZone } from './FolderDropZone';
import { useSoupView } from './soup-view-context';

type FallbackContent = {
  plural: string;
  graphic?: Component<{ class?: string }>;
  description?: JSXElement;
  create?: { label: string; blockName: BlockName | BlockAlias };
  documentationUrl?: string;
};

const FALLBACK_CONTENT: Partial<Record<ListView, FallbackContent>> = {
  documents: {
    plural: 'documents',
    graphic: EmptyStateDocIcon,
    description:
      'Write, collaborate, and share documents right inside Macro. Create notes, specs, or any long-form content and keep it alongside your conversations.',
    create: { label: 'New document', blockName: 'md' },
    documentationUrl: `${DOCS_BASE}/product/docs`,
  },
  channels: {
    plural: 'channels',
    graphic: EmptyStateChannelsIcon,
    description:
      'Channels are shared spaces for team conversations organized by topic, project, or team. Create a channel to start collaborating with your team.',
    create: { label: 'New channel', blockName: 'channel' },
    documentationUrl: `${DOCS_BASE}/product/channels`,
  },
  calls: {
    plural: 'calls',
    graphic: EmptyStateCallsIcon,
    description: (
      <>
        See recordings, transcriptions and summaries of your Macro calls.
        <br />
        Calls are available to agents.
      </>
    ),
    documentationUrl: `${DOCS_BASE}/product/calls`,
  },
};

export function EmptyState(props: {
  listView?: ListView;
  search?: boolean;
  hasRefinementsFromBase?: boolean;
  hasHiddenItems?: boolean;
  onClearFilters?: () => void;
}) {
  const emailActive = useEmailLinksStatus();
  const startAddInbox = useAddInboxFlow();
  const soup = useSoupView();

  const onConnectEmail = () => {
    void startAddInbox();
  };

  return (
    <Switch>
      <Match when={props.search}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoSearchMatchIcon}
          title={
            soup.searchText().trim().length > 0
              ? `No results for "${soup.searchText()}"`
              : 'No results'
          }
          description="Search across messages, documents, tasks, and more. Try a different query or broaden your filters."
          documentationUrl={`${DOCS_BASE}/product/search`}
        />
      </Match>

      <Match when={props.hasRefinementsFromBase}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoFilterMatchIcon}
          title="No items matching the filters"
          description="Try adjusting or clearing your filters to see more results."
        >
          {props.onClearFilters && (
            <FilteredHiddenBanner
              hasHiddenItems={false}
              onClearFilters={props.onClearFilters}
            />
          )}
        </EmptyStatePanel>
      </Match>

      <Match
        when={
          (props.listView === 'inbox' || props.listView === 'mail') &&
          !emailActive()
        }
      >
        <EmptyStatePanel
          graphic={EmptyStateEmailIcon}
          title="Connect your email"
          description="Bring your inbox into Macro to triage signal from noise, reply faster, and let agents work alongside your mail."
          primaryAction={{
            label: 'Connect email',
            onClick: onConnectEmail,
          }}
          documentationUrl={`${DOCS_BASE}/product/email`}
        />
      </Match>

      <Match when={props.listView === 'inbox' && emailActive()}>
        {(() => {
          // Each inbox tab filters to a different slice, so the empty copy
          // should match: Signal is the important stuff, Noise is explicitly
          // the low-priority stuff, and All spans everything.
          const tab = soup.activeTab();
          const { title, description } =
            tab === 'noise'
              ? {
                  title: 'No noise',
                  description: (
                    <>
                      Low-priority items like newsletters and notifications
                      collect here.
                      <br />
                      Nothing to clear right now.
                    </>
                  ),
                }
              : tab === 'all'
                ? {
                    title: 'Inbox zero',
                    description:
                      "You're all caught up. New items will appear here as they arrive.",
                  }
                : {
                    title: 'Inbox zero',
                    description:
                      "You're all caught up. Important items will appear here as they arrive.",
                  };
          return (
            <EmptyStatePanel
              graphic={EmptyStateInboxTrayIcon}
              title={title}
              description={description}
              documentationUrl={`${DOCS_BASE}/product/inbox`}
            />
          );
        })()}
      </Match>

      <Match when={props.listView === 'mail' && emailActive()}>
        <EmptyStatePanel
          graphic={EmptyStateInboxTrayIcon}
          title="Inbox zero"
          description="You're all caught up. New email will appear here as it arrives."
          documentationUrl={`${DOCS_BASE}/product/email`}
        />
      </Match>

      <Match when={props.listView === 'tasks'}>
        <EmptyStatePanel
          graphic={EmptyStateTasksIcon}
          title="Nothing to do"
          description="Tasks you create or that get assigned to you will show up here."
          primaryAction={{
            label: 'New task',
            icon: PlusIcon,
            onClick: () => runCreateAction('task'),
          }}
          documentationUrl={`${DOCS_BASE}/product/tasks`}
        />
      </Match>

      <Match
        when={props.listView === 'agents' && soup.activeTab() === 'automations'}
      >
        <EmptyStatePanel
          graphic={EmptyStateAutomationsIcon}
          title="No automations to show"
          description="Automations run in the background to handle repetitive work for you — like triaging messages, updating tasks, or sending follow-ups."
          primaryAction={{
            label: 'New automation',
            icon: PlusIcon,
            onClick: () => runCreateAction('automation'),
          }}
          documentationUrl={`${DOCS_BASE}/product/agents`}
        />
      </Match>

      <Match when={props.listView === 'agents'}>
        <EmptyStatePanel
          graphic={EmptyStateAiIcon}
          title="Get started with agents"
          description="Create an agent, or use Macro with your favorite AI chat client or code editor via MCP."
          primaryAction={{
            label: 'New agent',
            icon: PlusIcon,
            onClick: () => runCreateAction('chat'),
          }}
          documentationUrl={`${DOCS_BASE}/product/agents`}
        />
      </Match>

      <Match when={props.listView === 'companies'}>
        <EmptyStatePanel
          graphic={EmptyStateCompaniesIcon}
          title="No companies"
          description="Companies you add or sync into your CRM will appear here."
        />
      </Match>

      <Match when={props.listView === 'folders'}>
        <EmptyStatePanel
          graphic={EmptyStateFolderIcon}
          title="No folders"
          description="Folders let you organize conversations, documents, and tasks into projects. Create a folder or drop files below to get started."
          primaryAction={{
            label: 'New folder',
            icon: PlusIcon,
            onClick: () => runCreateAction('project'),
          }}
          documentationUrl={`${DOCS_BASE}/product/folders`}
        >
          <FolderDropZone />
        </EmptyStatePanel>
      </Match>

      <Match when={props.listView === 'search'}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoSearchMatchIcon}
          title="No items to show"
          description="Search across messages, documents, tasks, and more."
          documentationUrl={`${DOCS_BASE}/product/search`}
        />
      </Match>

      <Match when={true}>
        {(() => {
          const fallback = (props.listView &&
            FALLBACK_CONTENT[props.listView]) ?? {
            plural: 'items',
          };
          return (
            <EmptyStatePanel
              graphic={fallback.graphic ?? EmptyStateInboxZeroIcon}
              title={`No ${fallback.plural} to show`}
              description={fallback.description}
              primaryAction={
                fallback.create
                  ? {
                      label: fallback.create.label,
                      icon: PlusIcon,
                      onClick: () =>
                        runCreateAction(fallback.create!.blockName),
                    }
                  : undefined
              }
              documentationUrl={fallback.documentationUrl}
            />
          );
        })()}
      </Match>
    </Switch>
  );
}
