import type { Accessor } from 'solid-js';
import TextBoldIcon from '@icon/bold/text-b-bold.svg';
import TextCodeIcon from '@icon/regular/code.svg';
import ListBulletsIcon from '@icon/regular/list-bullets.svg';
import ListChecksIcon from '@icon/regular/list-checks.svg';
import ListNumbersIcon from '@icon/regular/list-numbers.svg';
import TextItalicIcon from '@icon/regular/text-italic.svg';
import TextStrikethroughIcon from '@icon/regular/text-strikethrough.svg';
import type {
  NodeTransformType,
  SelectionData,
} from '@core/component/LexicalMarkdown/plugins';
import type { TextFormatType } from 'lexical';
import { renderIcon } from './utils/render-icon';
import { RibbonButton } from './RibbonButton';

type FormatButtonsProps = {
  selectionState: Accessor<SelectionData | undefined>;
  onInlineFormat: (format: TextFormatType) => void;
  onNodeFormat: (format: NodeTransformType) => void;
};

export function FormatButtons(props: FormatButtonsProps) {
  return (
    <>
      <RibbonButton
        label="Bold"
        active={props.selectionState()?.bold}
        onClick={() => props.onInlineFormat('bold')}
      >
        {renderIcon(TextBoldIcon, 'size-5')}
      </RibbonButton>
      <RibbonButton
        label="Italic"
        active={props.selectionState()?.italic}
        onClick={() => props.onInlineFormat('italic')}
      >
        {renderIcon(TextItalicIcon, 'size-5')}
      </RibbonButton>
      <RibbonButton
        label="Strikethrough"
        active={props.selectionState()?.strikethrough}
        onClick={() => props.onInlineFormat('strikethrough')}
      >
        {renderIcon(TextStrikethroughIcon, 'size-5')}
      </RibbonButton>
      <RibbonButton
        label="Code"
        active={props.selectionState()?.code}
        onClick={() => props.onInlineFormat('code')}
      >
        {renderIcon(TextCodeIcon, 'size-5')}
      </RibbonButton>
      <div class="w-px h-5 bg-edge-muted" />
      <RibbonButton
        label="Bullet list"
        active={props.selectionState()?.elementsInRange.has('list-bullet')}
        onClick={() => props.onNodeFormat('list-bullet')}
      >
        {renderIcon(ListBulletsIcon, 'size-5')}
      </RibbonButton>
      <RibbonButton
        label="Numbered list"
        active={props.selectionState()?.elementsInRange.has('list-number')}
        onClick={() => props.onNodeFormat('list-number')}
      >
        {renderIcon(ListNumbersIcon, 'size-5')}
      </RibbonButton>
      <RibbonButton
        label="Checklist"
        active={props.selectionState()?.elementsInRange.has('list-check')}
        onClick={() => props.onNodeFormat('list-check')}
      >
        {renderIcon(ListChecksIcon, 'size-5')}
      </RibbonButton>
    </>
  );
}
