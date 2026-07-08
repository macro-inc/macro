import { useBlockId } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { UserIcon } from '@core/component/UserIcon';
import { useCanEdit } from '@core/signal/permissions';
import { tryMacroId, useDisplayName } from '@core/user';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { type DateValue, formatDate } from '@core/util/date';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo, Show } from 'solid-js';
import { EntityPropertiesSection } from './properties';
import { SidePanel } from './SidePanel';

export function FileSidePanelSections() {
  return (
    <>
      <FileDetailsSection order={10} />
      <FilePropertiesSection order={20} />
    </>
  );
}

export function FileDetailsSection(props: { order?: number }) {
  return (
    <SidePanel.Section
      id="details"
      title="Details"
      defaultOpen
      order={props.order}
    >
      <DetailsSectionContent />
    </SidePanel.Section>
  );
}

export function FilePropertiesSection(props: { order?: number }) {
  return (
    <SidePanel.Section
      id="properties"
      title="Properties"
      defaultOpen
      order={props.order}
    >
      <PropertiesSectionContent />
    </SidePanel.Section>
  );
}

function PropertiesSectionContent() {
  const blockId = useBlockId();
  const canEdit = useCanEdit();
  const documentName = useBlockDocumentName();

  return (
    <EntityPropertiesSection
      entityId={blockId}
      entityType="DOCUMENT"
      canEdit={canEdit()}
      documentName={documentName()}
    />
  );
}

function DetailsSectionContent() {
  const blockId = useBlockId();
  const query = useDocumentMetadataQuery(() => blockId);
  const metadata = createMemo(() => query.data);

  return (
    <SidePanel.Grid>
      <Show when={metadata()?.owner}>
        {(ownerId) => (
          <SidePanel.Row label="Owner">
            <OwnerValue ownerId={ownerId()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show
        when={(() => {
          const id = metadata()?.projectId;
          const name = metadata()?.projectName;
          return id && name ? { id, name } : undefined;
        })()}
      >
        {(folder) => (
          <SidePanel.Row label="Folder">
            <FolderLink projectId={folder().id} projectName={folder().name} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={metadata()?.createdAt}>
        {(created) => (
          <SidePanel.Row label="Created">
            <DateValueDisplay value={created()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={metadata()?.updatedAt}>
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
      class={SidePanel.pillClass + ' pointer-events-auto hover:bg-hover'}
    >
      <span class="relative size-3 shrink-0">
        <EntityIcon targetType="project" size="fill" />
      </span>
      <span class="truncate underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
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
      <span class="truncate">
        {formatDate(props.value, { showTime: true })}
      </span>
    </SidePanel.Pill>
  );
}
