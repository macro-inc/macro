import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { useBlockId } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { UserIcon } from '@core/component/UserIcon';
import { useCanEdit } from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { type DateValue, formatDate } from '@core/util/date';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo, Show } from 'solid-js';
import { SidePanel } from './SidePanel';

export function FileSidePanelSections() {
  return (
    <>
      <FileDetailsSection order={10} />
      <FileTagsSection order={20} />
      <FilePropertiesSection order={30} />
    </>
  );
}

export type DocumentFileSidePanelSectionsProps = {
  documentId: string;
  documentName: string;
  canEdit: boolean;
};

export function DocumentFileSidePanelSections(
  props: DocumentFileSidePanelSectionsProps
) {
  return (
    <>
      <DocumentFileDetailsSection documentId={props.documentId} order={10} />
      <EntityTagsSection
        entityId={props.documentId}
        entityType="DOCUMENT"
        canEdit={props.canEdit}
        order={20}
      />
      <DocumentFilePropertiesSection
        documentId={props.documentId}
        documentName={props.documentName}
        canEdit={props.canEdit}
        order={30}
      />
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
      <BlockDetailsSectionContent />
    </SidePanel.Section>
  );
}

export function DocumentFileDetailsSection(props: {
  documentId: string;
  order?: number;
}) {
  return (
    <SidePanel.Section
      id="details"
      title="Details"
      defaultOpen
      order={props.order}
    >
      <DetailsSectionContent documentId={props.documentId} />
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

export function DocumentFilePropertiesSection(props: {
  documentId: string;
  documentName: string;
  canEdit: boolean;
  order?: number;
}) {
  return (
    <SidePanel.Section
      id="properties"
      title="Properties"
      defaultOpen
      order={props.order}
    >
      <EntityPropertiesSection
        entityId={props.documentId}
        entityType="DOCUMENT"
        canEdit={props.canEdit}
        documentName={props.documentName}
        showTags={false}
      />
    </SidePanel.Section>
  );
}

export function FileTagsSection(props: { order?: number }) {
  const blockId = useBlockId();
  const canEdit = useCanEdit();

  return (
    <EntityTagsSection
      entityId={blockId}
      entityType="DOCUMENT"
      canEdit={canEdit()}
      order={props.order}
    />
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
      showTags={false}
    />
  );
}

function BlockDetailsSectionContent() {
  const blockId = useBlockId();
  return <DetailsSectionContent documentId={blockId} />;
}

function DetailsSectionContent(props: { documentId: string }) {
  const query = useDocumentMetadataQuery(() => props.documentId);
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

export function FolderLink(props: { projectId: string; projectName: string }) {
  const open = createCallback(() => {
    openDocument('project', props.projectId, undefined, true);
  });
  const navHandlers = useSplitNavigationHandler<HTMLSpanElement>(open);

  return (
    <span
      {...navHandlers}
      class={
        SidePanel.pillClass +
        ' pointer-events-auto text-link hover:text-link-hover hover:bg-hover'
      }
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

export function OwnerValue(props: { ownerId: string }) {
  const displayName = () => getDisplayName(tryMacroId(props.ownerId));

  return (
    <SidePanel.Pill>
      <UserIcon id={props.ownerId} size="sm" showTooltip suppressClick />
      <span class="truncate">{displayName()}</span>
    </SidePanel.Pill>
  );
}

export function DateValueDisplay(props: { value: DateValue }) {
  return (
    <SidePanel.Pill>
      <span class="truncate">
        {formatDate(props.value, { showTime: true })}
      </span>
    </SidePanel.Pill>
  );
}
