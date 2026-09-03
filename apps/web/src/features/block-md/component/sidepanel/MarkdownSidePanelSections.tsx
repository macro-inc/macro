import { EntityActivitySectionConditional } from '@app/features/activity/EntityActivitySection';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  GithubPullRequestDetailsRows,
  SidePanel,
  useSidePanel,
} from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { ProgressMeter } from '@core/component/LexicalMarkdown/component/status/Progress';
import { Wordcount } from '@core/component/LexicalMarkdown/component/status/Wordcount';
import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { Notifications } from '@core/component/Notifications';
import { References } from '@core/component/References';
import { UserIcon } from '@core/component/UserIcon';
import {
  enableHistoryComponent,
  isFeatureEnabled,
  USE_MACRO_PR_SUMMARY_BLOCK,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import type { Entity, EntityType } from '@core/types';
import { getDisplayName, tryMacroId } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import { openExternalUrl } from '@core/util/url';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { useNotificationsForEntity } from '@notifications';
import CaretRightIcon from '@phosphor/caret-right.svg';
import ClockIcon from '@phosphor/clock.svg';
import {
  getDefaultPinnedProperties,
  SYSTEM_PROPERTY_IDS,
} from '@property/constants';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import {
  type GithubPullRequestWithDetails,
  useDocumentGithubPullRequestsQuery,
} from '@queries/storage/github-pull-requests';
import {
  useDocumentTeamShareQuery,
  useSetDocumentTeamShareMutation,
} from '@queries/storage/team-share';
import type { EntityType as PropertiesEntityType } from '@service-properties/generated/schemas/entityType';
import { blockNameToItemType } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { cn, InlineCheckbox } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { useHistory } from '../../history/HistoryContext';
import { HistoryScrubber } from '../../history/HistoryScrubber';
import { HistorySessionList } from '../../history/HistorySessionList';
import { mdStore } from '../../signal/markdownBlockData';
import { TaskDuplicateMatchesSidePanelSection } from '../TaskDuplicateMatches';

interface MarkdownSidePanelSectionsProps {
  canEdit: boolean;
  documentName: string;
}

/**
 * Renders all three SidePanel sections for the markdown block:
 * - Properties (always shown)
 * - Details (always shown)
 * - Stats (hidden for tasks)
 */
export function MarkdownSidePanelSections(
  props: MarkdownSidePanelSectionsProps
) {
  const blockName = useBlockAliasedName();
  const rawBlockName = useBlockName();
  const blockId = useBlockId();
  const isTask = () => blockName === 'task';
  const isSnippet = () => blockName === 'snippet';

  const itemType = blockNameToItemType(rawBlockName);
  const entity = (): Entity => ({ id: blockId, type: itemType as EntityType });
  const propertiesEntityType = (): PropertiesEntityType =>
    blockName === 'task' ? 'TASK' : 'DOCUMENT';

  return (
    <>
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <DetailsSectionContent />
      </SidePanel.Section>
      <Show when={isSnippet()}>
        <SnippetSharingOwnerSectionConditional documentId={blockId} />
      </Show>
      <EntityTagsSection
        entityId={blockId}
        entityType={propertiesEntityType()}
        canEdit={props.canEdit}
        order={20}
      />
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={25}
      >
        <PropertiesSectionContent
          canEdit={props.canEdit}
          documentName={props.documentName}
        />
      </SidePanel.Section>
      <Show when={!isTask()}>
        <SidePanel.Section id="stats" title="Stats" order={30}>
          <StatsSectionContent />
        </SidePanel.Section>
      </Show>
      <Show when={isFeatureEnabled(enableHistoryComponent)}>
        <SidePanel.Section id="history" title="History" order={35}>
          <HistorySectionContent />
        </SidePanel.Section>
      </Show>
      <EntityActivitySectionConditional
        entityId={blockId}
        entityType={propertiesEntityType()}
        order={40}
      />
      <GithubSectionConditional documentId={blockId} isTask={isTask()} />
      <NotificationsSectionConditional entity={entity()} />
      <ReferencesSectionConditional documentId={blockId} />
      <Show when={isTask()}>
        <TaskDuplicateMatchesSidePanelSection />
      </Show>
    </>
  );
}

function HistorySectionContent() {
  const history = useHistory();
  const sidePanel = useSidePanel();
  const [showSessions, setShowSessions] = createSignal(false);

  createEffect(() => {
    if (history.isOpen()) {
      sidePanel?.setOpenSectionIds(['history']);
    }
  });

  // Discover whether history exists (to choose between the empty state and
  // the scrubber) once the user actually expands this accordion section —
  // nothing inside the section can trigger the load itself, since the
  // scrubber and "Show activity" toggle only render once sessions exist.
  createEffect(() => {
    if (sidePanel?.openSectionIds().includes('history')) {
      history.requestLoad();
    }
  });
  const isShowingSessions = () => history.isOpen() || showSessions();

  const totalEdits = createMemo(() => {
    const sessions = history.sessions();
    if (!sessions) return 0;
    return sessions.reduce((sum, s) => sum + s.count, 0);
  });

  return (
    <Show when={!history.loading.sessions()} fallback={<HistorySkeleton />}>
      <Show
        when={totalEdits() > 1 && history.sessions()}
        fallback={
          // Don't claim the document has no edits when we couldn't load them.
          <p
            class="text-xs text-ink-muted"
            title={history.error() ?? undefined}
          >
            {history.error() ? "Couldn't load history" : 'No history yet'}
          </p>
        }
      >
        {(sessions) => (
          <div class="hidden min-w-0 overflow-hidden md:block">
            <HistoryScrubber compact />
            <Show when={sessions().length > 0}>
              <div class="mt-3 min-w-0 border-edge-muted border-t pt-2">
                <button
                  type="button"
                  aria-expanded={isShowingSessions()}
                  class="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-ink-muted text-xs hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  onClick={() => {
                    history.enter();
                    setShowSessions(true);
                  }}
                >
                  <CaretRightIcon
                    class={cn(
                      'size-3 shrink-0 transition-transform duration-90',
                      isShowingSessions() && 'rotate-90'
                    )}
                  />
                  <span>
                    {isShowingSessions() ? 'Activity' : 'Show activity'}
                  </span>
                </button>
                <Show when={isShowingSessions()}>
                  <HistorySessionList
                    sessions={sessions()}
                    selectedAt={history.selectedAt}
                    onSelect={history.enter}
                    onViewSessionDiff={(session) => {
                      if (history.diff.session()?.startMs === session.startMs) {
                        history.diff.clear();
                      } else {
                        history.diff.view(session);
                      }
                    }}
                  />
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </Show>
  );
}

function HistorySkeleton() {
  return (
    <div
      aria-hidden="true"
      class="hidden min-w-0 flex-col gap-2.5 overflow-hidden md:flex"
    >
      <div class="skeleton-shimmer h-12 w-full rounded-md bg-skeleton" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sharing Section (snippets)
// ─────────────────────────────────────────────────────────────────────────────

function SnippetSharingOwnerSectionConditional(props: { documentId: string }) {
  const currentUserId = useUserId();
  const metadataQuery = useDocumentMetadataQuery(() => props.documentId);

  const isOwner = createMemo(() => {
    const ownerId = metadataQuery.data?.owner;
    const userId = currentUserId();
    return !!ownerId && !!userId && ownerId === userId;
  });

  return (
    <Show when={isOwner()}>
      <SnippetSharingTeamSectionConditional documentId={props.documentId} />
    </Show>
  );
}

/**
 * "Share with team" toggle for snippets. Only mounted for the snippet owner;
 * sharing grants the owner's team Edit access so teammates can insert and
 * maintain the snippet.
 */
function SnippetSharingTeamSectionConditional(props: { documentId: string }) {
  const teamShareQuery = useDocumentTeamShareQuery(() => props.documentId);

  return (
    <Show when={teamShareQuery.data?.teamId}>
      <SidePanel.Section id="sharing" title="Sharing" defaultOpen order={15}>
        <SnippetSharingSectionContent documentId={props.documentId} />
      </SidePanel.Section>
    </Show>
  );
}

function SnippetSharingSectionContent(props: { documentId: string }) {
  const teamShareQuery = useDocumentTeamShareQuery(() => props.documentId);
  const setTeamShare = useSetDocumentTeamShareMutation();

  const isShared = () => teamShareQuery.data?.sharedWithTeam ?? false;
  const isDisabled = () => setTeamShare.isPending || teamShareQuery.isPending;

  const handleChange = (checked: boolean) => {
    setTeamShare.mutate({
      documentId: props.documentId,
      shareWithTeam: checked,
    });
  };

  return (
    <div class="flex flex-col gap-2 text-xs">
      <button
        type="button"
        role="checkbox"
        aria-checked={isShared()}
        disabled={isDisabled()}
        onClick={() => handleChange(!isShared())}
        class={cn(
          'inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none w-fit',
          'border border-ink-muted/[0.08] bg-ink-muted/[0.025]',
          'text-ink-muted/70 hover:text-ink hover:bg-ink-muted/[0.06]',
          isShared() && 'text-ink',
          isDisabled() && 'pointer-events-none opacity-50'
        )}
      >
        <InlineCheckbox checked={isShared()} />
        <span class="whitespace-nowrap">Share with team</span>
      </button>
      <p class="text-ink-muted leading-5">
        Lets everyone on your team insert this snippet from the ; menu and edit
        it.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Details Section
// ─────────────────────────────────────────────────────────────────────────────

function DetailsSectionContent() {
  const blockId = useBlockId();
  const query = useDocumentMetadataQuery(() => blockId);
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
    <SidePanel.Grid>
      <Show when={props.owner()}>
        {(ownerId) => (
          <SidePanel.Row label="Owner">
            <OwnerValue ownerId={ownerId()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={props.folder()}>
        {(folder) => (
          <SidePanel.Row label="Folder">
            <FolderLink projectId={folder().id} projectName={folder().name} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={props.createdAt()}>
        {(created) => (
          <SidePanel.Row label="Created">
            <DateValueDisplay value={created()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={props.updatedAt()}>
        {(updated) => (
          <SidePanel.Row label="Last updated">
            <DateValueDisplay value={updated()} />
          </SidePanel.Row>
        )}
      </Show>
    </SidePanel.Grid>
  );
}

function FolderLink(props: { projectId: string; projectName: string }) {
  const open = createCallback((e: MouseEvent) => {
    openDocument('project', props.projectId, undefined, !e.shiftKey);
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

function OwnerValue(props: { ownerId: string }) {
  const displayName = () => getDisplayName(tryMacroId(props.ownerId));
  return (
    <SidePanel.Pill>
      <UserIcon id={props.ownerId} size="sm" showTooltip suppressClick />
      <span class="truncate">{displayName()}</span>
    </SidePanel.Pill>
  );
}

function DateValueDisplay(props: { value: DateValue }) {
  return (
    <SidePanel.Pill>
      <ClockIcon class="size-3 shrink-0" />
      <span class="truncate">
        {formatDate(props.value, { showTime: true })}
      </span>
    </SidePanel.Pill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Properties Section
// ─────────────────────────────────────────────────────────────────────────────

function PropertiesSectionContent(props: {
  canEdit: boolean;
  documentName: string;
}) {
  const blockId = useBlockId();
  const mdData = mdStore.get;

  const blockName = useBlockAliasedName();
  const entityType: PropertiesEntityType =
    blockName === 'task' ? 'TASK' : 'DOCUMENT';

  const [pinnedPropertyIds, setPinnedPropertyIds] = createSignal<string[]>([]);

  createEffect(() => {
    const currentEditor = mdData.editor;
    if (!currentEditor) return;
    currentEditor.getEditorState().read(() => {
      const ids = $getPinnedProperties();
      setPinnedPropertyIds(ids);
    });

    const unregister = currentEditor.registerUpdateListener(
      ({ editorState }) => {
        editorState.read(() => {
          const ids = $getPinnedProperties();
          setPinnedPropertyIds(ids);
        });
      }
    );
    onCleanup(unregister);
  });

  const handlePropertyPinned = (propertyId: string) => {
    const editor = mdData.editor;
    if (editor) {
      editor.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, propertyId);
    }
  };

  const handlePropertyUnpinned = (propertyId: string) => {
    const editor = mdData.editor;
    if (editor) {
      editor.dispatchCommand(REMOVE_PINNED_PROPERTY_COMMAND, propertyId);
    }
  };

  return (
    <EntityPropertiesSection
      entityId={blockId}
      entityType={entityType}
      canEdit={props.canEdit}
      documentName={props.documentName}
      defaultPinnedPropertyIds={() => getDefaultPinnedProperties(blockName)}
      pinnedPropertyIds={pinnedPropertyIds}
      pinnedPropertyDefinitionOrder={PINNED_ORDER}
      onPropertyPinned={handlePropertyPinned}
      onPropertyUnpinned={handlePropertyUnpinned}
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
  const md = mdStore.get;

  return (
    <Show
      when={md.wordcountStats}
      fallback={
        <div class="text-ink-muted text-xs py-2">No stats available</div>
      }
    >
      {(stats) => (
        <Wordcount.Root stats={stats()}>
          <SidePanel.Grid>
            <SidePanel.Row label="Words">
              <Wordcount.Words />
            </SidePanel.Row>
            <SidePanel.Row label="Characters">
              <Wordcount.Characters />
            </SidePanel.Row>
            <Show when={md.progressStats}>
              {(progressStats) => (
                <Show when={progressStats().total > 0}>
                  <SidePanel.Row label="Progress">
                    <ProgressMeter stats={progressStats()} />
                  </SidePanel.Row>
                </Show>
              )}
            </Show>
          </SidePanel.Grid>
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
    () => notifications().filter((n) => !n.viewed_at).length
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

  const count = createMemo(() => references.data?.length ?? 0);

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
