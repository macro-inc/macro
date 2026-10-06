import CaretDown from '@phosphor/caret-down.svg';
import { EditorMenu, type EditorMenuItem } from './editor-menu';

export function ViewerZoom(props: {
  label: string;
  items: (EditorMenuItem | 'divider')[];
}) {
  return (
    <EditorMenu
      label="Zoom and view options"
      testId="fig-zoom-menu"
      items={props.items}
    >
      <span class="min-w-8 text-right text-xs tabular-nums">{props.label}</span>
      <CaretDown class="size-3" />
    </EditorMenu>
  );
}
