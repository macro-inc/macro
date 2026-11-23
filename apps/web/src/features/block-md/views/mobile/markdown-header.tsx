import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import type { BlockTool } from '@components/app/block-tool';
import {
  CollaborationStatusIndicator,
  isCollaborationStatusVisible,
} from '@components/app/CollaborationStatusIndicator';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { AccessBadge } from '@components/app/split-layout/components/SplitLabel';
import { Permissions } from '@core/component/SharePermissions';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import type { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { type Accessor, Show } from 'solid-js';
import { markdownDocumentBlockName } from '../../component/MarkdownDetailBreadcrumbItem';
import { useMarkdownName } from '../../component/MarkdownNameProvider';
import {
  type MarkdownDocumentActions,
  useMarkdownDocumentTools,
} from '../../component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '../../context/markdown-document-context';
import {
  MarkdownAppearanceIcon,
  SkillBadge,
  useMarkdownHeaderEntity,
} from '../shared/markdown-header-parts';

/**
 * The title menu rows of the mobile header. Phones offer no version history,
 * and no wide mode because the document already fills the screen.
 */
export function mobileMarkdownHeaderMenu(
  actions: MarkdownDocumentActions
): BlockTool[] {
  return [
    ...(isMobile() ? [] : [actions.history, actions.wideMode]),
    actions.askMacro,
    actions.codeActions,
    actions.share,
  ];
}

/**
 * A Markdown document's header on touch: the title with its menu, sync state,
 * Ask Macro, and Info. Its block shows it, and so does a touch view that shows
 * the document beside its list (inside a `SplitHeaderScope`), so the header is
 * the same in both and at every width. It reads the document from its context,
 * not from a legacy Block.
 */
export function MobileMarkdownHeader(props: {
  collaborationStatus: Accessor<SyncSourceStatus | undefined>;
  /** The viewer's access for the title menu; the document's when omitted. */
  permissions?: Permissions;
  /** Where a host goes after the title menu's Duplicate and Delete. */
  onDuplicate?: (id: string, name: string) => void;
  onDelete?: () => void;
}) {
  const { documentId, kind, permissions } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const name = () => displayName() ?? '';
  const iconType = () => (kind() === 'document' ? 'md' : kind());
  const { fileOperations, actions } = useMarkdownDocumentTools();
  const headerEntity = useMarkdownHeaderEntity();
  const menuPermissions = () => {
    if (props.permissions !== undefined) return props.permissions;
    if (permissions.isOwner()) return Permissions.OWNER;
    if (permissions.canEdit()) return Permissions.CAN_EDIT;
    if (permissions.canComment()) return Permissions.CAN_COMMENT;
    return Permissions.CAN_VIEW;
  };

  return (
    <>
      <MobileHeader
        trailing={
          <>
            <Show
              when={isCollaborationStatusVisible(props.collaborationStatus())}
            >
              <MobileHeader.Island>
                <CollaborationStatusIndicator
                  status={props.collaborationStatus()}
                />
              </MobileHeader.Island>
            </Show>
            {/* No Dispatch Agent here: a phone has no room for it. Code
                Actions is in the title menu. */}
            <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
              <MobileHeader.Island>
                <div class="flex shrink-0 items-center gap-1">
                  <AskMacroButton
                    grouped
                    entity={{
                      type: 'document',
                      id: documentId(),
                      name: name(),
                      fileType: 'md',
                    }}
                  />
                </div>
              </MobileHeader.Island>
            </Show>
            <MobileHeader.Info />
          </>
        }
      >
        <MobileHeader.Title
          class="ph-no-capture"
          iconType={iconType()}
          colorIcon
          icon={
            <Show when={headerEntity()}>
              {(entity) => <MarkdownAppearanceIcon entity={entity()} />}
            </Show>
          }
          label={name()}
        />
        <SkillBadge />
        <MobileHeader.Island>
          <AccessBadge
            canEdit={permissions.canEdit()}
            canComment={permissions.canComment()}
            canView
          />
        </MobileHeader.Island>
      </MobileHeader>

      <SplitFileMenu
        id={documentId()}
        itemType="document"
        name={name()}
        ops={fileOperations}
        tools={mobileMarkdownHeaderMenu(actions)}
        entity={headerEntity()}
        entityKind={markdownDocumentBlockName(kind())}
        permissions={menuPermissions()}
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
