import type {
  NodeTransformType,
  SelectionData,
} from '@core/component/LexicalMarkdown/plugins';
import type { HotkeyToken } from '@core/hotkey/tokens';
import TextCodeIcon from '@icon/code.svg';
import ListBulletsIcon from '@icon/list-bullets.svg';
import ListChecksIcon from '@icon/list-checks.svg';
import ListNumbersIcon from '@icon/list-numbers.svg';
import TextQuoteIcon from '@icon/quotes.svg';
import TextBoldIcon from '@icon/text-b.svg';
import TextItalicIcon from '@icon/text-italic.svg';
import TextStrikethroughIcon from '@icon/text-strikethrough.svg';
import { Button } from '@ui';
import type { TextFormatType } from 'lexical';
import type { Accessor, JSX } from 'solid-js';

type FormatButtonsProps = {
  selectionState: Accessor<SelectionData | undefined>;
  onInlineFormat: (format: TextFormatType) => void;
  onNodeFormat: (format: NodeTransformType) => void;
};

export function FormatButtons(props: FormatButtonsProps) {
  const selection = () => props.selectionState();
  const elementsInRange = () => selection()?.elementsInRange;

  const toggleNodeFormat = (format: NodeTransformType) => {
    const isActive = elementsInRange()?.has(format);
    props.onNodeFormat(isActive ? 'paragraph' : format);
  };

  return (
    <>
      <FormatButton
        label="Bold"
        active={selection()?.bold}
        onClick={() => props.onInlineFormat('bold')}
      >
        <TextBoldIcon />
      </FormatButton>
      <FormatButton
        label="Italic"
        active={selection()?.italic}
        onClick={() => props.onInlineFormat('italic')}
      >
        <TextItalicIcon />
      </FormatButton>
      <FormatButton
        label="Strikethrough"
        active={selection()?.strikethrough}
        onClick={() => props.onInlineFormat('strikethrough')}
      >
        <TextStrikethroughIcon />
      </FormatButton>
      <FormatButton
        label="Inline code"
        active={selection()?.code}
        onClick={() => props.onInlineFormat('code')}
      >
        <TextCodeIcon />
      </FormatButton>
      <div class="w-px h-5 bg-edge-muted" />
      <FormatButton
        label="Bulleted list"
        active={elementsInRange()?.has('list-bullet')}
        onClick={() => toggleNodeFormat('list-bullet')}
      >
        <ListBulletsIcon />
      </FormatButton>
      <FormatButton
        label="Numbered list"
        active={elementsInRange()?.has('list-number')}
        onClick={() => toggleNodeFormat('list-number')}
      >
        <ListNumbersIcon />
      </FormatButton>
      <FormatButton
        label="Checklist"
        active={elementsInRange()?.has('list-check')}
        onClick={() => toggleNodeFormat('list-check')}
      >
        <ListChecksIcon />
      </FormatButton>
      <FormatButton
        label="Blockquote"
        active={elementsInRange()?.has('quote')}
        onClick={() => toggleNodeFormat('quote')}
      >
        <TextQuoteIcon />
      </FormatButton>
    </>
  );
}

type FormatButtonProps = {
  label: string;
  hotkeyToken?: HotkeyToken;
  active?: boolean;
  onClick: () => void;
  children: JSX.Element;
};

function FormatButton(props: FormatButtonProps) {
  return (
    <Button
      aria-label={props.label}
      title={props.label}
      label={props.label}
      hotkey={props.hotkeyToken}
      variant="ghost"
      size="icon-sm"
      class={props.active ? 'bg-active text-ink' : ''}
      onPointerDown={(event: PointerEvent) => event.preventDefault()}
      onClick={() => props.onClick()}
    >
      {props.children}
    </Button>
  );
}
