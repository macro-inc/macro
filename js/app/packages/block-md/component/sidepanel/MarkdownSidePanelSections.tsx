import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SidePanel } from '@app/component/side-panel';
import { EntityPropertiesSection } from '@app/component/side-panel/properties';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { Wordcount } from '@core/component/LexicalMarkdown/component/status/Wordcount';
import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { Notifications } from '@core/component/Notifications';
import { References } from '@core/component/References';
import { UserIcon } from '@core/component/UserIcon';
import type { Entity, EntityType } from '@core/types';
import { tryMacroId, useDisplayName } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import GithubIcon from '@icon/mcp-github.svg';
import { useNotificationsForEntity } from '@notifications';
import ClockIcon from '@phosphor/clock.svg';
import {
  getDefaultPinnedProperties,
  SYSTEM_PROPERTY_IDS,
} from '@property/constants';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { useDocumentGithubPullRequestsQuery } from '@queries/storage/github-pull-requests';
import type { EntityType as PropertiesEntityType } from '@service-properties/generated/schemas/entityType';
import {
  blockNameToItemType,
  storageServiceClient,
} from '@service-storage/client';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
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

  const itemType = blockNameToItemType(rawBlockName);
  const entity = (): Entity => ({ id: blockId, type: itemType as EntityType });

  return (
    <>
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <DetailsSectionContent />
      </SidePanel.Section>
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={20}
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
      <GithubSectionConditional documentId={blockId} isTask={isTask()} />
      <NotificationsSectionConditional entity={entity()} />
      <ReferencesSectionConditional documentId={blockId} />
      <Show when={isTask()}>
        <TaskDuplicateMatchesSidePanelSection />
      </Show>
    </>
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
      class="pointer-events-auto min-w-0 truncate py-0.5 rounded-xs hover:bg-hover focus:bg-active"
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
  const [displayName] = useDisplayName(tryMacroId(props.ownerId));
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
  const [references] = createResource(
    () => props.documentId,
    async (id) => {
      const response = await storageServiceClient.attachmentReferences({
        entity_type: 'document',
        entity_id: id,
      });

      if (response.isErr()) {
        console.error(response);
        return [];
      }

      return response.value.references;
    }
  );

  const count = createMemo(() => references()?.length ?? 0);

  return (
    <Show when={count() > 0}>
      <SidePanel.Section
        id="references"
        title={<SidePanel.CountTitle label="References" count={count()} />}
        order={50}
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

  const pullRequests = createMemo((): GithubPullRequest[] => {
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
        <SidePanel.Grid>
          <SidePanel.Row label={count() === 1 ? 'PR' : 'PRs'}>
            <div class="flex min-w-0 flex-wrap items-center gap-x-1">
              <For each={pullRequests()}>
                {(pr, i) => (
                  <>
                    <Show when={i() > 0}>
                      <span class="text-ink-extra-muted">,</span>
                    </Show>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex min-w-0 items-center gap-1 text-ink hover:text-ink"
                      title={
                        pr.name?.trim()
                          ? `${pr.name.trim()} ${pr.displayName}`
                          : pr.displayName
                      }
                    >
                      <GithubIcon
                        class="size-3 shrink-0 text-ink-extra-muted"
                        aria-hidden="true"
                      />
                      <span class="truncate underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2 hover:decoration-current">
                        {pr.displayName}
                      </span>
                    </a>
                  </>
                )}
              </For>
            </div>
          </SidePanel.Row>
        </SidePanel.Grid>
      </SidePanel.Section>
    </Show>
  );
}
