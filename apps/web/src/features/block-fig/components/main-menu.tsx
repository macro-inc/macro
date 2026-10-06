/** File, edit, view, and layer commands grouped like Figma's main menu. */
import { IS_MAC } from '@core/constant/isMac';
import List from '@phosphor/list.svg';
import { paletteActions } from '../core/palette';
import { EDIT_ACTIONS, type ViewerAction } from '../core/shortcuts';
import { EditorMenu, type EditorMenuItem } from './editor-menu';

const SELECTION_COMMANDS: ReadonlySet<ViewerAction> = new Set([
  'copy',
  'cut',
  'paste-replace',
  'duplicate',
  'delete',
  'group',
  'ungroup',
  'frame-selection',
  'add-auto-layout',
  'remove-auto-layout',
  'create-component',
  'detach-instance',
  'toggle-visible',
  'toggle-locked',
  'rename',
  'bring-to-front',
  'bring-forward',
  'send-backward',
  'send-to-back',
  'align-left',
  'align-center',
  'align-right',
  'align-top',
  'align-middle',
  'align-bottom',
  'distribute-horizontal',
  'distribute-vertical',
  'flip-horizontal',
  'flip-vertical',
]);

export function MainMenu(props: {
  canEdit: boolean;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoomItems: (EditorMenuItem | 'divider')[];
  onRun: (action: ViewerAction) => void;
  onExportFramesPdf: () => void;
}) {
  const menuAction = (id: ViewerAction, label?: string): EditorMenuItem => {
    const action = paletteActions('').find((item) => item.id === id);
    const keys = !IS_MAC && action?.otherKeys ? action.otherKeys : action?.keys;
    return {
      label: label ?? action?.label ?? id,
      shortcut: keys
        ?.map((key) => (key === 'mod' ? (IS_MAC ? '⌘' : 'Ctrl') : key))
        .join(IS_MAC ? '' : '+'),
      disabled:
        (EDIT_ACTIONS.has(id) && !props.canEdit) ||
        (SELECTION_COMMANDS.has(id) && !props.hasSelection) ||
        (id === 'undo' && !props.canUndo) ||
        (id === 'redo' && !props.canRedo),
      onSelect: () => props.onRun(id),
      testId: id === 'undo' || id === 'redo' ? `fig-${id}` : `fig-main-${id}`,
    };
  };

  return (
    <EditorMenu
      label="Main menu"
      testId="fig-main-menu"
      items={[
        {
          label: 'Actions…',
          shortcut: IS_MAC ? '⌘P' : 'Ctrl+P',
          onSelect: () => props.onRun('open-actions'),
        },
        'divider',
        {
          label: 'File',
          testId: 'fig-main-file',
          items: [
            menuAction('place-image', 'Place image…'),
            'divider',
            {
              label: 'Export frames to PDF…',
              onSelect: () => props.onExportFramesPdf(),
              testId: 'fig-menu-export-frames-pdf',
            },
            {
              ...menuAction('export', 'Export selection…'),
              testId: 'fig-menu-export-selection',
            },
          ],
        },
        {
          label: 'Edit',
          testId: 'fig-main-edit',
          items: [
            menuAction('undo'),
            menuAction('redo'),
            'divider',
            menuAction('copy'),
            menuAction('cut'),
            {
              ...menuAction('paste', 'Paste'),
              shortcut: IS_MAC ? '⌘V' : 'Ctrl+V',
            },
            menuAction('paste-replace'),
            'divider',
            menuAction('duplicate'),
            menuAction('delete'),
            'divider',
            menuAction('select-all'),
            menuAction('find'),
          ],
        },
        {
          label: 'View',
          testId: 'fig-main-view',
          items: [
            ...props.zoomItems,
            'divider',
            menuAction('toggle-layers'),
            menuAction('toggle-assets'),
            menuAction('toggle-design'),
          ],
        },
        {
          label: 'Object',
          testId: 'fig-main-object',
          items: [
            menuAction('group', 'Group selection'),
            menuAction('ungroup'),
            menuAction('frame-selection'),
            'divider',
            menuAction('add-auto-layout'),
            menuAction('remove-auto-layout'),
            'divider',
            menuAction('create-component'),
            menuAction('detach-instance'),
            'divider',
            menuAction('toggle-visible', 'Show/hide selection'),
            menuAction('toggle-locked', 'Lock/unlock selection'),
            menuAction('rename'),
          ],
        },
        {
          label: 'Arrange',
          testId: 'fig-main-arrange',
          items: [
            menuAction('bring-to-front'),
            menuAction('bring-forward'),
            menuAction('send-backward'),
            menuAction('send-to-back'),
            'divider',
            menuAction('align-left'),
            menuAction('align-center'),
            menuAction('align-right'),
            menuAction('align-top'),
            menuAction('align-middle'),
            menuAction('align-bottom'),
            'divider',
            menuAction('distribute-horizontal'),
            menuAction('distribute-vertical'),
            'divider',
            menuAction('flip-horizontal'),
            menuAction('flip-vertical'),
          ],
        },
        'divider',
        menuAction('show-shortcuts'),
      ]}
    >
      <List class="size-4" />
    </EditorMenu>
  );
}
