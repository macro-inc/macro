import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import FormatIcon from '@icon/regular/text-aa.svg';
import Check from '@phosphor-icons/core/regular/check.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { createSignal, onCleanup, onMount, type Setter, Show } from 'solid-js';
import { ActionButton } from '../ActionButton';
import { FormatRibbon } from '../FormatRibbon';
import { useChannelMarkdownArea } from '../MarkdownArea';
import { isMobile } from '@core/mobile/isMobile';

export function EditMessageInput(props: {
  setEditing: Setter<boolean>;
  save: (input: string) => void;
  content: string;
}) {
  const originalContent = props.content;
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);

  const {
    focus: focusMarkdownArea,
    state: markdownState,
    formatState: markdownFormatState,
    setInlineFormat,
    setNodeFormat,
    MarkdownArea,
  } = useChannelMarkdownArea();

  onMount(() => {
    setTimeout(() => {
      focusMarkdownArea();
    }, 200);

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        props.setEditing(false);
      }
    };

    document.addEventListener('keydown', handleEscape);

    onCleanup(() => {
      document.removeEventListener('keydown', handleEscape);
    });
  });

  return (
    <div class="relative -left-3 text-sm w-full bg-input overflow-hidden border border-edge-muted focus-within:border-accent flex flex-col gap-1 items-center mt-4 ">
      <Show when={showFormatRibbon()}>
        <FormatRibbon
          state={markdownFormatState}
          inlineFormat={setInlineFormat}
          nodeFormat={setNodeFormat}
        />
      </Show>
      <div class="w-full px-3">
        <MarkdownArea
          initialValue={originalContent}
          onEnter={(e: KeyboardEvent) => {
            if (isMobile()) return false;
            e.preventDefault();
            const currentContent = markdownState();
            if (
              currentContent !== originalContent &&
              currentContent.length > 0
            ) {
              props.save(currentContent);
            }
            props.setEditing(false);
            return true;
          }}
        />
      </div>
      <div class="w-full flex flex-row gap-1 items-center justify-between p-2">
        <ActionButton
          tooltip="Format"
          onClick={(e) => {
            e.preventDefault();
            setShowFormatRibbon((prev) => !prev);
          }}
          clicked={showFormatRibbon()}
        >
          <FormatIcon width={20} height={20} />
        </ActionButton>
        <div class="flex flex-row gap-1 items-center">
          <DeprecatedTextButton
            icon={XIcon}
            text="Cancel"
            theme="clear"
            onClick={() => props.setEditing(false)}
          />
          <DeprecatedTextButton
            icon={Check}
            text="Save"
            theme="accent"
            onClick={() => {
              const currentContent = markdownState();
              if (
                currentContent !== originalContent &&
                currentContent.length > 0
              ) {
                props.save(currentContent);
              }
              props.setEditing(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}
