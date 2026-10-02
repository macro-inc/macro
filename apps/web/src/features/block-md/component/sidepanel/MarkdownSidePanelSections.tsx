import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  GithubPullRequestDetailsRows,
  SidePanel,
} from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { Wordcount } from '@core/component/LexicalMarkdown/component/status/Wordcount';
import { Notifications } from '@core/component/Notifications';
import { References } from '@core/component/References';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import type { Entity } from '@core/types';
import type { DateValue } from '@core/util/date';
import { openExternalUrl } from '@core/util/url';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { useNotificationsForEntity } from '@notifications';
import {
  getDefaultPinnedProperties,
  SYSTEM_PROPERTY_IDS,
} from '@property/constants';
import { queryReadyGate } from '@queries/gate';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import {
  type GithubPullRequestWithDetails,
  useDocumentGithubPullRequestsQuery,
} from '@queries/storage/github-pull-requests';
import type { EntityType as PropertiesEntityType } from '@service-properties/generated/schemas/entityType';
import { createCallback } from '@solid-primitives/rootless';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { useMarkdownDocument } from '../../context/markdown-document-context';
import { createPinnedProperties } from '../../primitives/create-pinned-properties';
import { DispatchAgentButton } from '../DispatchAgentMenu';
import { useMarkdownName } from '../MarkdownNameProvider';
import { TaskDuplicateMatchesSidePanelSection } from '../TaskDuplicateMatches';

/** Registers markdown header actions, panel sections, and metadata footer. */
export function MarkdownSidePanelSections() {
  const { documentId, kind, permissions } = useMarkdownDocument();
  const canEdit = permissions.canEdit;
  const { displayName } = useMarkdownName();
  const isTask = () => kind() === 'task';
  const canDispatchToAgent = () => isTask() || kind() === 'document';
  const entity = (): Entity => ({
    id: documentId(),
    type: 'document',
  });
  const propertiesEntityType = (): PropertiesEntityType =>
    isTask() ? 'TASK' : 'DOCUMENT';

  return (
    <>
      <SidePanel.HeaderActions>
        <div class="flex shrink-0 items-center gap-1">
          <Show when={canDispatchToAgent() && !isMobile()}>
            <DispatchAgentButton showPrimaryLabel />
          </Show>
          <AskMacroButton
            entity={{
              type: 'document',
              id: documentId(),
              name: displayName() ?? '',
              fileType: 'md',
            }}
          />
        </div>
      </SidePanel.HeaderActions>
      <SidePanel.Footer>
        <Show when={!isTask()}>
          <StatsSectionContent />
        </Show>
        <DetailsSectionContent documentId={documentId()} />
      </SidePanel.Footer>
      <EntityTagsSection
        entityId={documentId()}
        entityType={propertiesEntityType()}
        canEdit={canEdit()}
        order={20}
      />
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={25}
      >
        <PropertiesSectionContent
          documentId={documentId()}
          isTask={isTask()}
          canEdit={canEdit()}
          documentName={displayName() ?? ''}
        />
      </SidePanel.Section>
      <EntityActivitySectionConditional
        entityId={documentId()}
        entityType={propertiesEntityType()}
        order={40}
      />
      <GithubSectionConditional documentId={documentId()} isTask={isTask()} />
      <NotificationsSectionConditional entity={entity()} />
      <ReferencesSectionConditional documentId={documentId()} />
      <Show when={isTask()}>
        <TaskDuplicateMatchesSidePanelSection />
      </Show>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Details Section
// ─────────────────────────────────────────────────────────────────────────────

function DetailsSectionContent(props: { documentId: string }) {
  const query = useDocumentMetadataQuery(() => props.documentId);
  const metadata = createMemo(() => query.data);

  return (
    <DetailsGrid
      owner={() => metadata()?.owner}
      folder={() => {
        const id = metadata()?.projectId;
        const name = metadata()?.projectName;
        return id && name ? { id, name } : undefined;
      }}
      createdAt={() => metadata()?.createdAt}
      updatedAt={() => metadata()?.updatedAt}
    />
  );
}

function DetailsGrid(props: {
  owner: () => string | undefined;
  folder: () => { id: string; name: string } | undefined;
  createdAt: () => DateValue | null | undefined;
  updatedAt: () => DateValue | null | undefined;
}) {
  return (
    <EntityMetadata
      ownerId={props.owner()}
      createdAt={props.createdAt()}
      updatedAt={props.updatedAt()}
    >
      <Show when={props.folder()}>
        {(folder) => (
          <div class="flex items-center gap-1">
            Folder
            <FolderLink projectId={folder().id} projectName={folder().name} />
          </div>
        )}
      </Show>
    </EntityMetadata>
  );
}

function FolderLink(props: { projectId: string; projectName: string }) {
  const open = createCallback(() => {
    openDocument('project', props.projectId, undefined, true);
  });
  const navHandlers = useSplitNavigationHandler<HTMLSpanElement>(open);
  return (
    <span
      {...navHandlers}
      class="pointer-events-auto min-w-0 truncate py-0.5 rounded-xs text-link hover:text-link-hover hover:bg-hover focus:bg-active"
    >
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
        <EntityIcon targetType="project" size="fill" />
      </span>
      <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        {props.projectName}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Properties Section
// ─────────────────────────────────────────────────────────────────────────────

function PropertiesSectionContent(props: {
  documentId: string;
  isTask: boolean;
  canEdit: boolean;
  documentName: string;
}) {
  const { state } = useMarkdownDocument();
  const mdData = state.editor.md;

  const entityType: PropertiesEntityType = props.isTask ? 'TASK' : 'DOCUMENT';

  const pins = createPinnedProperties(() => mdData.editor);

  return (
    <EntityPropertiesSection
      entityId={props.documentId}
      entityType={entityType}
      canEdit={props.canEdit}
      documentName={props.documentName}
      defaultPinnedPropertyIds={() =>
        props.isTask ? getDefaultPinnedProperties('task') : []
      }
      pinnedPropertyIds={pins.ids}
      pinnedPropertyDefinitionOrder={PINNED_ORDER}
      onPropertyUnpinned={pins.unpin}
      showTags={false}
    />
  );
}

// Side-panel ordering: Status, Priority, Assignees pinned to the top so the
// most-frequently scanned task properties always sit in the same place; the
// remaining properties keep their incoming order below.
const PINNED_ORDER: readonly string[] = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];

// ─────────────────────────────────────────────────────────────────────────────
// Stats Section
// ─────────────────────────────────────────────────────────────────────────────

function StatsSectionContent() {
  const { state } = useMarkdownDocument();
  const md = state.editor.md;

  return (
    <Show when={md.wordcountStats}>
      {(stats) => (
        <Wordcount.Root stats={stats()}>
          <div class="mb-1">
            <Wordcount.Words /> words · <Wordcount.Characters /> characters
          </div>
        </Wordcount.Root>
      )}
    </Show>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications Section (conditional)
// ─────────────────────────────────────────────────────────────────────────────

function NotificationsSectionConditional(props: { entity: Entity }) {
  const notificationSource = useGlobalNotificationSource();
  const notifications = useNotificationsForEntity(
    notificationSource,
    props.entity
  );
  const count = createMemo(() => notifications().length);
  const unreadCount = createMemo(
    () => notifications().filter((n) => n.state === 'unseen').length
  );

  return (
    <Show when={count() > 0}>
      <SidePanel.Section
        id="notifications"
        title={
          <SidePanel.CountTitle label="Notifications" count={unreadCount()} />
        }
        order={40}
      >
        <div class="text-xs">
          <Notifications
            entity={props.entity}
            notificationSource={notificationSource}
          />
        </div>
      </SidePanel.Section>
    </Show>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// References Section (conditional)
// ─────────────────────────────────────────────────────────────────────────────

function ReferencesSectionConditional(props: { documentId: string }) {
  const references = useAttachmentReferencesQuery(
    () => props.documentId,
    () => 'document'
  );

  const count = () => (queryReadyGate(references) ? references.data.length : 0);

  return (
    <Show when={count() > 0}>
      <SidePanel.Section
        id="references"
        title={<SidePanel.CountTitle label="References" count={count()} />}
        order={33}
      >
        <div class="text-xs">
          <References documentId={props.documentId} />
        </div>
      </SidePanel.Section>
    </Show>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Section (conditional)
// ─────────────────────────────────────────────────────────────────────────────

function GithubSectionConditional(props: {
  documentId: string;
  isTask: boolean;
}) {
  const query = useDocumentGithubPullRequestsQuery(
    props.documentId,
    props.isTask
  );
  const { openWithSplit } = useSplitLayout();

  const pullRequests = createMemo((): GithubPullRequestWithDetails[] => {
    if (!props.isTask || query.isLoading || query.isError) return [];
    return query.data?.pullRequests ?? [];
  });
  const count = createMemo(() => pullRequests().length);

  return (
    <Show when={count() > 0}>
      <SidePanel.Section
        id="github"
        title={<SidePanel.CountTitle label="GitHub" count={count()} />}
        order={35}
      >
        <div class="flex flex-col gap-4">
          <For each={pullRequests()}>
            {(pr, index) => {
              const title = () => pr.name?.trim() || pr.displayName;
              const openPullRequest = () => {
                if (USE_MACRO_PR_SUMMARY_BLOCK && pr.foreignEntityId) {
                  openWithSplit(
                    {
                      type: 'pr',
                      id: pr.foreignEntityId,
                    },
                    { referredFrom: null }
                  );
                  return;
                }
                openExternalUrl(pr.url);
              };

              return (
                <div
                  class={cn(
                    'flex flex-col',
                    index() > 0 && 'border-t border-edge-muted pt-4'
                  )}
                >
                  <SidePanel.Grid class="auto-rows-[minmax(1.75rem,auto)]">
                    <span class="text-ink-muted truncate self-start pt-[0.3125rem]">
                      PR
                    </span>
                    <div class="min-w-0 max-w-full overflow-hidden self-start py-0.5">
                      <button
                        type="button"
                        class="block min-w-0 max-w-full text-left whitespace-normal wrap-break-word leading-snug underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2 hover:decoration-current"
                        title={title()}
                        onClick={openPullRequest}
                      >
                        {title()}
                      </button>
                    </div>
                    <GithubPullRequestDetailsRows enrichment={pr} />
                  </SidePanel.Grid>
                </div>
              );
            }}
          </For>
        </div>
      </SidePanel.Section>
    </Show>
  );
}
