import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SidePanel } from '@app/component/side-panel';
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
import { Modals } from '@core/component/Properties/component/modal';
import { PanelContainer } from '@core/component/Properties/component/panel';
import { getDefaultPinnedProperties } from '@core/component/Properties/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
  usePropertiesContext,
} from '@core/component/Properties/context/PropertiesContext';
import { useEntityProperties } from '@core/component/Properties/hooks';
import type {
  Property,
  PropertyApiValues,
} from '@core/component/Properties/types';
import { References } from '@core/component/References';
import { UserIcon } from '@core/component/UserIcon';
import type { Entity, EntityType } from '@core/types';
import { tryMacroId, useDisplayName } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';

import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { useNotificationsForEntity } from '@notifications';
import Plus from '@phosphor/plus.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { commsServiceClient } from '@service-comms/client';
import type { EntityType as PropertiesEntityType } from '@service-properties/generated/schemas/entityType';
import { blockNameToItemType } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { mdStore } from '../../signal/markdownBlockData';

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
      <NotificationsSectionConditional entity={entity()} />
      <ReferencesSectionConditional documentId={blockId} />
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
    <Suspense fallback={<DetailsLoading />}>
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
    </Suspense>
  );
}

function DetailsLoading() {
  return (
    <div class="flex justify-center items-center py-8">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted" />
    </div>
  );
}

function DetailsGrid(props: {
  owner: () => string | undefined;
  folder: () => { id: string; name: string } | undefined;
  createdAt: () => DateValue | null | undefined;
  updatedAt: () => DateValue | null | undefined;
}) {
  return (
    <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2 items-center text-xs">
      <Show when={props.owner()}>
        {(ownerId) => (
          <DetailsRow label="Owner">
            <OwnerValue ownerId={ownerId()} />
          </DetailsRow>
        )}
      </Show>
      <Show when={props.folder()}>
        {(folder) => (
          <DetailsRow label="Folder">
            <FolderLink projectId={folder().id} projectName={folder().name} />
          </DetailsRow>
        )}
      </Show>
      <Show when={props.createdAt()}>
        {(created) => (
          <DetailsRow label="Created">
            <span>{formatDate(created(), { showTime: true })}</span>
          </DetailsRow>
        )}
      </Show>
      <Show when={props.updatedAt()}>
        {(updated) => (
          <DetailsRow label="Last updated">
            <span>{formatDate(updated(), { showTime: true })}</span>
          </DetailsRow>
        )}
      </Show>
    </div>
  );
}

function DetailsRow(props: {
  label: string;
  children: import('solid-js').JSX.Element;
}) {
  return (
    <>
      <span class="text-ink-muted">{props.label}</span>
      <div class="flex items-center gap-2 min-w-0">{props.children}</div>
    </>
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
    <div class="rounded-full flex gap-1 items-center px-1">
      <div class="flex">
        <UserIcon id={props.ownerId} size="sm" showTooltip suppressClick />
      </div>
      <span class="truncate">{displayName()}</span>
    </div>
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

  const { properties, isLoading, error, refetch } = useEntityProperties(
    blockId,
    entityType,
    false
  );

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

  const docMetadataQuery = useDocumentMetadataQuery(() => blockId);
  const createdByProperty = createMemo<Property | null>(() => {
    if (entityType !== 'TASK') return null;
    const ownerId = docMetadataQuery.data?.owner;
    if (!ownerId) return null;
    const now = new Date();
    return {
      propertyId: `${blockId}-created-by`,
      propertyDefinitionId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      displayName: 'Created By',
      isMultiSelect: false,
      isMetadata: true,
      owner: { scope: 'system' },
      specificEntityType: 'USER',
      createdAt: now,
      updatedAt: now,
      valueType: 'ENTITY',
      value: [{ entity_id: ownerId, entity_type: 'USER' }],
    };
  });

  const filteredPinnedProperties = createMemo(() => {
    const allProps = properties();
    const pinnedIds = pinnedPropertyIds();
    const defaultPinnedIds = getDefaultPinnedProperties(blockName);

    const pinned = allProps.filter(
      (prop) =>
        !prop.isMetadata &&
        (defaultPinnedIds.includes(prop.propertyDefinitionId) ||
          pinnedIds.includes(prop.propertyId))
    );

    const createdBy = createdByProperty();
    return createdBy ? [createdBy, ...pinned] : pinned;
  });

  const [pendingPinDefIds, setPendingPinDefIds] = createSignal<Set<string>>(
    new Set()
  );

  const handlePropertyAdded = async (addedDefinitionIds?: string[]) => {
    if (addedDefinitionIds && addedDefinitionIds.length > 0) {
      setPendingPinDefIds((prev) => {
        const next = new Set(prev);
        for (const id of addedDefinitionIds) next.add(id);
        return next;
      });
    }
    refetch();
  };

  const handlePropertyDeleted = async () => {
    refetch();
  };

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

  createEffect(() => {
    const pending = pendingPinDefIds();
    if (pending.size === 0) return;
    const current = properties();
    const remaining = new Set(pending);
    for (const defId of pending) {
      const instance = current.find((p) => p.propertyDefinitionId === defId);
      if (instance) {
        handlePropertyPinned(instance.propertyId);
        remaining.delete(defId);
      }
    }
    if (remaining.size !== pending.size) {
      setPendingPinDefIds(remaining);
    }
  });

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        { entityId: blockId, entityType: entityType, property, apiValues },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <Show
      when={!error()}
      fallback={
        <div class="text-failure-ink text-center py-4 text-xs">{error()}</div>
      }
    >
      <Suspense>
        <div class="text-xs">
          <PropertiesProvider
            entityType={entityType}
            canEdit={props.canEdit}
            documentName={props.documentName}
            properties={filteredPinnedProperties}
            onRefresh={refetch}
            onPropertyAdded={handlePropertyAdded}
            onPropertyDeleted={handlePropertyDeleted}
            onPropertyPinned={handlePropertyPinned}
            onPropertyUnpinned={handlePropertyUnpinned}
            pinnedPropertyIds={pinnedPropertyIds}
            saveHandler={saveHandler}
          >
            <Show when={isLoading()}>
              <div class="flex items-center justify-center py-8">
                <div class="w-5 h-5 animate-spin">
                  <LoadingSpinner />
                </div>
              </div>
            </Show>

            <Show when={filteredPinnedProperties().length > 0}>
              <PanelContainer
                properties={filteredPinnedProperties}
                isLoading={isLoading}
                error={error}
              />
            </Show>

            <Show when={props.canEdit}>
              <div class="py-2">
                <AddPinnedPropertyButton />
              </div>
            </Show>
            <Modals />
          </PropertiesProvider>
        </div>
      </Suspense>
    </Show>
  );
}

function AddPinnedPropertyButton() {
  const { openPropertySelector } = usePropertiesContext();
  return (
    <button
      class="flex items-center gap-1 opacity-75 hover:opacity-50 transition-opacity"
      onClick={openPropertySelector}
    >
      <Plus class="w-3 h-3 mr-2" />
      <span class="text-ink-muted">Add property</span>
    </button>
  );
}

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
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 items-center text-xs">
            <span class="text-xs text-ink-muted">Words</span>
            <div class="flex items-center gap-2 min-w-0">
              <Wordcount.Words />
            </div>

            <span class="text-xs text-ink-muted">Characters</span>
            <div class="flex items-center gap-2 min-w-0">
              <Wordcount.Characters />
            </div>
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
    () => notifications().filter((n) => !n.viewed_at).length
  );

  const title = () => (
    <>
      Notifications
      <Show when={unreadCount() > 0}>
        {' '}
        <span class="text-ink-extra-muted">({unreadCount()})</span>
      </Show>
    </>
  );

  return (
    <Show when={count() > 0}>
      <SidePanel.Section id="notifications" title={title()} order={40}>
        <Suspense
          fallback={
            <div class="flex justify-center py-8">
              <div class="animate-spin rounded-full size-6 border-b-2 border-ink-muted" />
            </div>
          }
        >
          <div class="text-xs">
            <Notifications
              entity={props.entity}
              notificationSource={notificationSource}
            />
          </div>
        </Suspense>
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
      const response = await commsServiceClient.attachmentReferences({
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

  const title = () => (
    <>
      References
      <Show when={count() > 0}>
        {' '}
        <span class="text-ink-extra-muted">({count()})</span>
      </Show>
    </>
  );

  return (
    <Show when={count() > 0}>
      <SidePanel.Section id="references" title={title()} order={50}>
        <Suspense
          fallback={
            <div class="flex justify-center py-8">
              <div class="animate-spin rounded-full size-6 border-b-2 border-ink-muted" />
            </div>
          }
        >
          <div class="text-xs">
            <References documentId={props.documentId} />
          </div>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}
