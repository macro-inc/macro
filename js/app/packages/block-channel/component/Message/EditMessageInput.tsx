import { TextButton } from '@core/component/TextButton';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import Check from '@phosphor-icons/core/regular/check.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { onCleanup, onMount, type Setter } from 'solid-js';
import { useChannelMarkdownArea } from '../MarkdownArea';

export function EditMessageInput(props: {
  setEditing: Setter<boolean>;
  save: (input: string) => void;
  content: string;
}) {
  const originalContent = props.content;

  const {
    focus: focusMarkdownArea,
    state: markdownState,
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
      <div class="w-full px-3">
        <MarkdownArea
          initialValue={originalContent}
          onEnter={(e: KeyboardEvent) => {
            if (isMobileWidth()) return false;
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
      <div class="w-full flex flex-row gap-1 items-center justify-end p-2">
        <TextButton
          icon={XIcon}
          text="Cancel"
          theme="clear"
          onClick={() => props.setEditing(false)}
        />
        <TextButton
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
  );
}
