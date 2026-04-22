import type { Accessor } from 'solid-js';
import TextBoldIcon from '@icon/bold/text-b-bold.svg';
import TextCodeIcon from '@icon/regular/code.svg';
import ListBulletsIcon from '@icon/regular/list-bullets.svg';
import ListChecksIcon from '@icon/regular/list-checks.svg';
import ListNumbersIcon from '@icon/regular/list-numbers.svg';
import TextItalicIcon from '@icon/regular/text-italic.svg';
import TextStrikethroughIcon from '@icon/regular/text-strikethrough.svg';
import TextQuoteIcon from '@icon/regular/quotes.svg';
import type {
  NodeTransformType,
  SelectionData,
} from '@core/component/LexicalMarkdown/plugins';
import type { TextFormatType } from 'lexical';
import { RibbonButton } from './RibbonButton';

type FormatButtonsProps = {
  selectionState: Accessor<SelectionData | undefined>;
  onInlineFormat: (format: TextFormatType) => void;
  onNodeFormat: (format: NodeTransformType) => void;
  includeQuote?: boolean;
};

export function FormatButtons(props: FormatButtonsProps) {
  return (
    <>
      <RibbonButton
        label="Bold"
        active={props.selectionState()?.bold}
        onClick={() => props.onInlineFormat('bold')}
      >
        <TextBoldIcon class="size-5" />
      </RibbonButton>
      <RibbonButton
        label="Italic"
        active={props.selectionState()?.italic}
        onClick={() => props.onInlineFormat('italic')}
      >
        <TextItalicIcon class="size-5" />
      </RibbonButton>
      <RibbonButton
        label="Strikethrough"
        active={props.selectionState()?.strikethrough}
        onClick={() => props.onInlineFormat('strikethrough')}
      >
        <TextStrikethroughIcon class="size-5" />
      </RibbonButton>
      <RibbonButton
        label="Code"
        active={props.selectionState()?.code}
        onClick={() => props.onInlineFormat('code')}
      >
        <TextCodeIcon class="size-5" />
      </RibbonButton>
      <div class="w-px h-5 bg-edge-muted" />
      <RibbonButton
        label="Bullet list"
        active={props.selectionState()?.elementsInRange.has('list-bullet')}
        onClick={() => props.onNodeFormat('list-bullet')}
      >
        <ListBulletsIcon class="size-5" />
      </RibbonButton>
      <RibbonButton
        label="Numbered list"
        active={props.selectionState()?.elementsInRange.has('list-number')}
        onClick={() => props.onNodeFormat('list-number')}
      >
        <ListNumbersIcon class="size-5" />
      </RibbonButton>
      <RibbonButton
        label="Checklist"
        active={props.selectionState()?.elementsInRange.has('list-check')}
        onClick={() => props.onNodeFormat('list-check')}
      >
        <ListChecksIcon class="size-5" />
      </RibbonButton>
      {props.includeQuote && (
        <RibbonButton
          label="Blockquote"
          active={props.selectionState()?.elementsInRange.has('quote')}
          onClick={() => props.onNodeFormat('quote')}
        >
          <TextQuoteIcon class="size-5" />
        </RibbonButton>
      )}
    </>
  );
}
