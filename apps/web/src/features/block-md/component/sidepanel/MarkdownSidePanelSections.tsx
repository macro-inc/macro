import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  GithubPullRequestDetailsRows,
  SidePanel,
} from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { Notifications } from '@core/component/Notifications';
import { References } from '@core/component/References';
import { UserIcon } from '@core/component/UserIcon';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import type { Entity } from '@core/types';
import { getDisplayName, tryMacroId } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import { openExternalUrl } from '@core/util/url';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { useNotificationsForEntity } from '@notifications';
import ClockIcon from '@phosphor/clock.svg';
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
import {
  useDocumentTeamShareQuery,
  useSetDocumentTeamShareMutation,
} from '@queries/storage/team-share';
import type { EntityType as PropertiesEntityType } from '@service-properties/generated/schemas/entityType';
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
import { useMarkdownDocument } from '../../context/markdown-document-context';
import { useMarkdownName } from '../MarkdownNameProvider';
import { TaskDuplicateMatchesSidePanelSection } from '../TaskDuplicateMatches';

/**
 * Remaining SidePanel sections for the markdown block.
 *
 * Actions / Ask Macro live in the top bar; History and Stats live in the
 * `...` file menu. Activity is still here until it merges into Discussion.
 */
export function MarkdownSidePanelSections() {
  const { documentId, kind, permissions } = useMarkdownDocument();
  const canEdit = permissions.canEdit;
  const { displayName } = useMarkdownName();
  const isTask = () => kind() === 'task';
  const isSnippet = () => kind() === 'snippet';
  const entity = (): Entity => ({
    id: documentId(),
    type: 'document',
  });
  const propertiesEntityType = (): PropertiesEntityType =>
    isTask() ? 'TASK' : 'DOCUMENT';

  return (
    <>
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <DetailsSectionContent documentId={documentId()} />
      </SidePanel.Section>
      <Show when={isSnippet()}>
        <SnippetSharingOwnerSectionConditional documentId={documentId()} />
      </Show>
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
  documentId: string;
  isTask: boolean;
  canEdit: boolean;
  documentName: string;
}) {
  const { state } = useMarkdownDocument();
  const mdData = state.editor.md;

  const entityType: PropertiesEntityType = props.isTask ? 'TASK' : 'DOCUMENT';

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
      entityId={props.documentId}
      entityType={entityType}
      canEdit={props.canEdit}
      documentName={props.documentName}
      defaultPinnedPropertyIds={() =>
        props.isTask ? getDefaultPinnedProperties('task') : []
      }
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
