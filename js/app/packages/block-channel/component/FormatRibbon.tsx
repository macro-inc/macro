import type {
  NodeTransformType,
  SelectionData,
} from '@core/component/LexicalMarkdown/plugins';
import TextBold from '@icon/bold/text-b-bold.svg';
import TextCode from '@icon/regular/code.svg';
import ListBullets from '@icon/regular/list-bullets.svg';
import ListChecks from '@icon/regular/list-checks.svg';
import ListNumbers from '@icon/regular/list-numbers.svg';
import TextItalic from '@icon/regular/text-italic.svg';
import TextStriketrough from '@icon/regular/text-strikethrough.svg';
import type { TextFormatType } from 'lexical';
import { ActionButton } from './ActionButton';

export type FormatRibbonProps = {
  state: SelectionData;
  inlineFormat: (format: TextFormatType) => void;
  nodeFormat: (transform: NodeTransformType) => void;
};

export function FormatRibbon(props: FormatRibbonProps) {
  return (
    <div class="flex flex-row w-full gap-2 items-center bg-input rounded-t-md p-2">
      <ActionButton
        tooltip="Bold"
        shortcut="meta+b"
        darker
        clicked={props.state.bold}
        onClick={(e) => {
          e.preventDefault();
          props.inlineFormat('bold');
        }}
      >
        <TextBold width={20} height={20} />
      </ActionButton>
      <ActionButton
        tooltip="Italic"
        shortcut="meta+i"
        darker
        clicked={props.state.italic}
        onClick={(e) => {
          e.preventDefault();
          props.inlineFormat('italic');
        }}
      >
        <TextItalic width={20} height={20} />
      </ActionButton>
      <ActionButton
        tooltip="Strikethrough"
        shortcut="meta+shift+x"
        darker
        clicked={props.state.strikethrough}
        onClick={(e) => {
          e.preventDefault();
          props.inlineFormat('strikethrough');
        }}
      >
        <TextStriketrough width={20} height={20} />
      </ActionButton>
      <ActionButton
        tooltip="Code"
        shortcut="meta+e"
        darker
        clicked={props.state.strikethrough}
        onClick={(e) => {
          e.preventDefault();
          props.inlineFormat('code');
        }}
      >
        <TextCode width={20} height={20} />
      </ActionButton>
      <div class="w-[1px] h-[20px] bg-edge" />
      <ActionButton
        tooltip="Bullet List"
        darker
        clicked={props.state.elementsInRange.has('list-bullet')}
        onClick={(e) => {
          e.preventDefault();
          props.nodeFormat('list-bullet');
        }}
      >
        <ListBullets width={20} height={20} />
      </ActionButton>
      <ActionButton
        tooltip="Numbered List"
        darker
        clicked={props.state.elementsInRange.has('list-number')}
        onClick={(e) => {
          e.preventDefault();
          props.nodeFormat('list-number');
        }}
      >
        <ListNumbers width={20} height={20} />
      </ActionButton>
      <ActionButton
        tooltip="Checklist"
        darker
        clicked={props.state.elementsInRange.has('list-check')}
        onClick={(e) => {
          e.preventDefault();
          props.nodeFormat('list-check');
        }}
      >
        <ListChecks width={20} height={20} />
      </ActionButton>
    </div>
  );
}
