import { runCreateAction } from '@app/component/Launcher';
import type { ListView } from '@app/constants/list-views';
import type { BlockAlias, BlockName } from '@core/block';
import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';
import { toast } from '@core/component/Toast/Toast';
import { useEmailLinks, useEmailLinksStatus } from '@core/email-link';
import EmptyStateAiIcon from '@design/empty-state-ai.svg';
import EmptyStateDocIcon from '@design/empty-state-doc.svg';
import EmptyStateEmailIcon from '@design/empty-state-email.svg';
import EmptyStateFolderIcon from '@design/empty-state-folder.svg';
import EmptyStateInboxZeroIcon from '@design/empty-state-inbox-zero.svg';
import EmptyStateNoFilterMatchIcon from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchIcon from '@design/empty-state-no-search-match.svg';
import EmptyStateTasksIcon from '@design/empty-state-tasks.svg';
import PlusIcon from '@phosphor/plus.svg';
import { EmptyStatePanel, FilteredHiddenBanner } from '@ui';
import { type Component, Match, Switch } from 'solid-js';
import { FolderDropZone } from './FolderDropZone';
import { useSoupView } from './soup-view-context';

// Base URL for the public documentation site (https://docs.macro.com).
const DOCS_BASE = 'https://docs.macro.com';

type FallbackContent = {
  plural: string;
  graphic?: Component<{ class?: string }>;
  create?: { label: string; blockName: BlockName | BlockAlias };
  documentationUrl?: string;
};

const FALLBACK_CONTENT: Partial<Record<ListView, FallbackContent>> = {
  documents: {
    plural: 'documents',
    graphic: EmptyStateDocIcon,
    create: { label: 'New document', blockName: 'md' },
    documentationUrl: `${DOCS_BASE}/product/docs`,
  },
  channels: {
    plural: 'channels',
    create: { label: 'New channel', blockName: 'channel' },
    documentationUrl: `${DOCS_BASE}/product/channels`,
  },
  calls: { plural: 'calls', documentationUrl: `${DOCS_BASE}/product/calls` },
  search: { plural: 'items' },
};

function InboxZeroNumber(props: { class?: string }) {
  return (
    <div
      class={`flex items-center justify-center font-mono text-[9rem] font-thin leading-none text-ink-muted ${props.class ?? ''}`}
    >
      0
    </div>
  );
}

export function EmptyState(props: {
  listView?: ListView;
  search?: boolean;
  hasRefinementsFromBase?: boolean;
  hasHiddenItems?: boolean;
  onClearFilters?: () => void;
}) {
  const emailActive = useEmailLinksStatus();
  const { connect } = useEmailLinks();
  const soup = useSoupView();

  const onConnectEmail = () => {
    connect().match(
      () => {},
      () => toast.failure('Failed to connect email')
    );
  };

  return (
    <Switch>
      <Match when={props.search}>
        <EmptyStatePanel
          align="center"
          graphic={EmptyStateNoSearchMatchIcon}
          title={
            soup.searchText().trim().length > 0
              ? `No results for "${soup.searchText()}"`
              : 'No results'
          }
          documentationUrl={`${DOCS_BASE}/product/search-1`}
        />
      </Match>

      <Match when={props.hasRefinementsFromBase}>
        <EmptyStatePanel
          align="center"
          graphic={EmptyStateNoFilterMatchIcon}
          title="No items matching the filters"
        >
          {props.onClearFilters && (
            <FilteredHiddenBanner
              hasHiddenItems={props.hasHiddenItems}
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
        <EmptyStatePanel
          align="center"
          graphic={InboxZeroNumber}
          title="Inbox zero"
          description="You're all caught up. Important items will appear here as they arrive."
          documentationUrl={`${DOCS_BASE}/product/inbox`}
        />
      </Match>

      <Match when={props.listView === 'mail' && emailActive()}>
        <EmptyStatePanel
          align="center"
          graphic={InboxZeroNumber}
          title="Inbox zero"
          description="You're all caught up. New email will appear here as it arrives."
          documentationUrl={`${DOCS_BASE}/product/email`}
        />
      </Match>

      <Match when={props.listView === 'tasks'}>
        <EmptyStatePanel
          align="center"
          graphic={EmptyStateTasksIcon}
          graphicClass="h-36 w-36"
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
          align="center"
          graphic={EmptyStateInboxZeroIcon}
          title="No automations to show"
          primaryAction={{
            label: 'New automation',
            icon: PlusIcon,
            onClick: () => runCreateAction('automation'),
          }}
        />
      </Match>

      <Match when={props.listView === 'agents'}>
        <AgentsEmptyState />
      </Match>

      <Match when={props.listView === 'folders'}>
        <EmptyStatePanel
          graphic={EmptyStateFolderIcon}
          title="No folders"
          description="Create a folder or drop files below to get started."
        >
          <FolderDropZone />
        </EmptyStatePanel>
      </Match>

      <Match when={true}>
        {(() => {
          const fallback = (props.listView &&
            FALLBACK_CONTENT[props.listView]) ?? {
            plural: 'items',
          };
          return (
            <EmptyStatePanel
              align="center"
              graphic={fallback.graphic ?? EmptyStateInboxZeroIcon}
              title={`No ${fallback.plural} to show`}
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

function AgentsEmptyState() {
  // Shares the left-aligned EmptyStatePanel layout with the folders / connect-email
  // empty states; the MCP setup cards render below the actions as panel children.
  return (
    <div class="size-full" data-soup-empty-state>
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
      >
        <McpSetupCards />
      </EmptyStatePanel>
    </div>
  );
}
