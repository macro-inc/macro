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
import PlusCircleIcon from '@phosphor/plus-circle.svg';
import { Button, EmptyStatePanel, FilteredHiddenBanner } from '@ui';
import { type Component, Match, Switch } from 'solid-js';
import { FolderDropZone } from './FolderDropZone';
import { useSoupView } from './soup-view-context';

type FallbackContent = {
  plural: string;
  graphic?: Component<{ class?: string }>;
  create?: { label: string; blockName: BlockName | BlockAlias };
};

const FALLBACK_CONTENT: Partial<Record<ListView, FallbackContent>> = {
  documents: {
    plural: 'documents',
    graphic: EmptyStateDocIcon,
    create: { label: 'Create document', blockName: 'md' },
  },
  channels: {
    plural: 'channels',
    create: { label: 'Create channel', blockName: 'channel' },
  },
  calls: { plural: 'calls' },
  search: { plural: 'items' },
};

function InboxZeroNumber(props: { class?: string }) {
  return (
    <div
      class={`flex items-center justify-center font-mono text-[9rem] font-thin leading-none text-ink-muted opacity-50 ${props.class ?? ''}`}
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
        />
      </Match>

      <Match when={props.listView === 'inbox' && emailActive()}>
        <EmptyStatePanel
          align="center"
          graphic={InboxZeroNumber}
          title="Inbox zero"
          description="You're all caught up. Important items will appear here as they arrive."
        />
      </Match>

      <Match when={props.listView === 'mail' && emailActive()}>
        <EmptyStatePanel
          align="center"
          graphic={InboxZeroNumber}
          title="Inbox zero"
          description="You're all caught up. New email will appear here as it arrives."
        />
      </Match>

      <Match when={props.listView === 'tasks'}>
        <EmptyStatePanel
          align="center"
          graphic={EmptyStateTasksIcon}
          title="Nothing to do"
          description="Tasks you create or that get assigned to you will show up here."
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
            label: 'Create automation',
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
                      onClick: () =>
                        runCreateAction(fallback.create!.blockName),
                    }
                  : undefined
              }
            />
          );
        })()}
      </Match>
    </Switch>
  );
}

function AgentsEmptyState() {
  return (
    <div class="size-full relative overflow-hidden" data-soup-empty-state>
      <div class="relative size-full flex flex-col items-center overflow-y-auto p-4">
        <div class="w-full max-w-2xl mt-32 @max-sm:mt-20 px-4 pb-8 flex flex-col gap-6">
          <div class="flex flex-col items-center gap-2">
            <div class="h-48 w-48 -mb-8 text-ink-muted">
              <EmptyStateAiIcon class="size-full" />
            </div>
            <Button
              variant="cta"
              size="lg"
              onClick={() => runCreateAction('chat')}
            >
              <PlusCircleIcon />
              <span>New Agent</span>
            </Button>
          </div>
          <div class="flex flex-col gap-4">
            <div>
              <p class="mt-1 text-sm text-ink-extra-muted">
                Create an agent above, or use Macro with your favorite AI chat
                client or code editor via MCP.
              </p>
            </div>
            <McpSetupCards />
          </div>
        </div>
      </div>
    </div>
  );
}
