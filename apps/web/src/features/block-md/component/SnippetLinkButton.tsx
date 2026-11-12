import CheckIcon from '@icon/system/bold/check-bold.svg?component-solid';
import LinkIcon from '@icon/system/regular/link.svg?component-solid';
import { Toolbar } from '@ui';
import { Dynamic } from 'solid-js/web';

/** The body popup's Copy link to snippet control; the caller owns copying. */
export function SnippetLinkButton(props: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <Toolbar.Button
      aria-label="Copy link to snippet"
      size="icon-sm"
      onClick={() => props.onCopy()}
      tooltip="Copy link to snippet"
    >
      <Dynamic
        component={props.copied ? CheckIcon : LinkIcon}
        class={props.copied ? 'text-success-ink size-4' : 'size-4'}
      />
    </Toolbar.Button>
  );
}
