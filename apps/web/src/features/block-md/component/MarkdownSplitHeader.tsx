import {
  CollaborationStatusIndicator,
  isCollaborationStatusVisible,
} from '@components/app/CollaborationStatusIndicator';
import {
  ResponsiveAccessBadge,
  ResponsiveDocumentToolbar,
} from '@components/app/ResponsiveBlockToolbar';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  EntitySplitLabel,
  type SplitLabelDocument,
} from '@components/app/split-layout/components/SplitLabel';
import { Permissions } from '@core/component/SharePermissions';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import type { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { blockNameToItemType } from '@service-storage/client';
import { type JSX, Show } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { markdownDocumentBlockName } from './MarkdownDetailBreadcrumbItem';
import { useMarkdownName } from './MarkdownNameProvider';
import { useMarkdownDocumentTools } from './useMarkdownDocumentTools';

/**
 * A markdown document's split header: its title island with the file menu,
 * access badge, sync status, and tools. The standalone block and inline
 * previews (inside a `SplitHeaderScope`) both render it, so a document's
 * header looks the same in a split of its own and beside a list.
 */
export function MarkdownSplitHeader(props: {
  /** Hover-card details for the title. */
  document?: SplitLabelDocument;
  collaborationStatus?: SyncSourceStatus;
  /** Access for the file menu; derived from the document's when omitted. */
  permissions?: Permissions;
  /** Extra actions before the tools, such as live viewers. */
  actions?: JSX.Element;
  onDuplicate?: (id: string, name: string) => void;
  onDelete?: () => void;
}) {
  const document = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const { fileOperations, menuTools, tools } = useMarkdownDocumentTools();
  const entityKind = () => markdownDocumentBlockName(document.kind());
  const itemType = () => blockNameToItemType(entityKind()) ?? 'document';
  const name = () =>
    displayName() ||
    document.fallbackName() ||
    blockNameToDefaultFile(entityKind());
  const permissions = () => {
    if (props.permissions !== undefined) return props.permissions;
    if (document.permissions.isOwner()) return Permissions.OWNER;
    if (document.permissions.canEdit()) return Permissions.CAN_EDIT;
    if (document.permissions.canComment()) return Permissions.CAN_COMMENT;
    return Permissions.CAN_VIEW;
  };

  return (
    <>
      <SplitHeaderLeft>
        <EntitySplitLabel
          targetType={entityKind()}
          name={name()}
          document={props.document}
          lockRename={!document.permissions.isOwner()}
        />
        <Show when={document.kind() === 'skill'}>
          <span class="ml-1.5 inline-flex shrink-0 items-center self-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
            Skill
          </span>
        </Show>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <Show when={isCollaborationStatusVisible(props.collaborationStatus)}>
          <HeaderIsland class="-order-1">
            <CollaborationStatusIndicator status={props.collaborationStatus} />
          </HeaderIsland>
        </Show>
        {props.actions}
      </SplitHeaderRight>

      <ResponsiveAccessBadge
        canEdit={document.permissions.canEdit()}
        canComment={document.permissions.canComment()}
        canView
      />

      <ResponsiveDocumentToolbar
        tools={tools}
        menuTools={menuTools}
        ops={fileOperations}
        id={document.documentId()}
        itemType={itemType()}
        name={name()}
        entityKind={entityKind()}
        permissions={permissions()}
        onDuplicate={
          props.onDuplicate
            ? (id) => props.onDuplicate?.(id, name())
            : undefined
        }
        onDelete={props.onDelete}
      />
    </>
  );
}
