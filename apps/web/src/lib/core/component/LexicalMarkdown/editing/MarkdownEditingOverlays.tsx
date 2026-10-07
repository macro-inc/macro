import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { LexicalEditor } from 'lexical';
import { type Accessor, type JSX, Show } from 'solid-js';
import { DecoratorRenderer } from '../component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '../component/core/NodeAccessoryRenderer';
import { ActionMenu } from '../component/menu/ActionsMenu';
import { EmojiMenu } from '../component/menu/EmojiMenu';
import { FloatingEquationMenu } from '../component/menu/FloatingEquationMenu';
import { FloatingLinkMenu } from '../component/menu/FloatingLinkMenu';
import { FloatingTableMenu } from '../component/menu/FloatingTableMenu';
import { MentionsMenu } from '../component/menu/MentionsMenu/MentionsMenu';
import { SnippetsMenu } from '../component/menu/SnippetsMenu';
import { DraggableBlockMenu } from '../component/misc/DraggableBlockMenu';
import { DragInsertIndicator } from '../component/misc/DragInsertIndicator';
import { TableCellResizer } from '../component/misc/TableCellResizer';
import { TableDeleteButtons } from '../component/misc/TableDeleteButtons';
import { TableInsertButton } from '../component/misc/TableInsertButton';
import { TableMoveHandle } from '../component/misc/TableMoveHandle';
import { TableSelectionActionBar } from '../component/misc/TableSelectionActionBar';
import { TaskListControlsRenderer } from '../component/task-list/TaskListControls';
import { FloatingMenuGroup } from '../context/FloatingMenuContext';
import type {
  MarkdownEditing,
  MarkdownEditingSource,
} from './registerMarkdownEditing';

/**
 * Menus, floating editors, and block and table controls for the features
 * `registerMarkdownEditing` registered. Render inside the editor's
 * `LexicalWrapperContext`.
 */
export function MarkdownEditingOverlays(props: {
  editor: LexicalEditor;
  editing: MarkdownEditing;
  source: MarkdownEditingSource;
  canEdit: Accessor<boolean>;
  /** Keep inline menus inside the hosting block. */
  useBlockBoundary: boolean;
  /** Offer the user's open tabs in the mentions menu. */
  showOpenTabs?: boolean;
  /** More floating menus sharing the group, e.g. a document's popups. */
  floatingMenus?: JSX.Element;
}) {
  const [dragInsertStore] = props.editing.dragInsert;
  const [draggableBlockStore, setDraggableBlockStore] =
    props.editing.draggableBlock;
  const [accessoryStore] = props.editing.accessories;
  return (
    <>
      <DecoratorRenderer editor={props.editor} />
      <NodeAccessoryRenderer editor={props.editor} store={accessoryStore} />
      <Show when={props.editing.checklistControls}>
        {(data) => (
          <TaskListControlsRenderer editor={props.editor} data={data()} />
        )}
      </Show>

      <DragInsertIndicator state={dragInsertStore} active={props.canEdit()} />

      <DraggableBlockMenu
        state={draggableBlockStore}
        setState={setDraggableBlockStore}
        active={props.canEdit()}
      />

      <EmojiMenu
        editor={props.editor}
        menu={props.editing.menus.emoji}
        useBlockBoundary={props.useBlockBoundary}
      />

      <MentionsMenu
        editor={props.editor}
        menu={props.editing.menus.mentions}
        useBlockBoundary={props.useBlockBoundary}
        showOpenTabs={props.showOpenTabs}
        disableMentionTracking={!props.source.trackMentions}
      />

      <SnippetsMenu
        editor={props.editor}
        menu={props.editing.menus.snippets}
        useBlockBoundary={props.useBlockBoundary}
        sourceDocumentId={props.source.id}
      />

      <ActionMenu
        editor={props.editor}
        menu={props.editing.menus.actions}
        actionContext={{
          sourceDocumentId: props.source.id,
          sourceBlockName: props.source.blockName,
          disableMentionTracking: !props.source.trackMentions,
        }}
      />

      <FloatingMenuGroup>
        <FloatingLinkMenu autoLinkMatchMode="common-tlds" />
        <FloatingEquationMenu canEdit={props.canEdit} />
        <FloatingTableMenu canEdit={props.canEdit} />
        {props.floatingMenus}
      </FloatingMenuGroup>

      <Show when={props.canEdit()}>
        {/* On touch devices the hover-driven controls are unusable */}
        {isTouchDevice() ? (
          <TableSelectionActionBar />
        ) : (
          <>
            <TableInsertButton />
            <TableDeleteButtons />
          </>
        )}
        <TableCellResizer />
        <TableMoveHandle />
      </Show>
    </>
  );
}
