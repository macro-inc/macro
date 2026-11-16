import CheckIcon from '@icon/system/bold/check-bold.svg?component-solid';
import { normalizeLinkUrl } from '@macro-inc/lexical-core/utils/auto-link';
import { Button } from '@ui';
import { createSignal, onCleanup } from 'solid-js';
import { type BodyPopupSlot, promptSlot } from './body-popup-slots';
import type { BodyFormattingPopupHost } from './types';

/**
 * Source MarkdownPopup's link prompt: FormatTools' Link button replaces the
 * toolbar with "Paste or insert link"; the selection is captured when it opens
 * (Source savedLinkSelection) and submit inserts the link over it with the
 * selected text as its label (Source INSERT_LINK_COMMAND).
 */
export function createNativeLinkSlot(
  popup: Pick<BodyFormattingPopupHost, 'captureLink'>
): BodyPopupSlot {
  const [input, setInput] = createSignal('');
  return promptSlot({
    id: 'link',
    available: () => true,
    capture: () => popup.captureLink(),
    dismissed: () => setInput(''),
    prompt: (control) => {
      const submit = () => {
        const value = input().trim();
        if (!normalizeLinkUrl(value)) return;
        control.value.insert(value);
        setInput('');
        control.close();
      };
      return (
        <>
          <input
            type="text"
            class="h-6 grow bg-transparent pl-2 text-sm placeholder:text-ink-placeholder focus:outline-none"
            placeholder="Paste or insert link"
            value={input()}
            ref={(element) => {
              const frame = requestAnimationFrame(() => element.focus());
              onCleanup(() => cancelAnimationFrame(frame));
            }}
            onInput={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setInput('');
                control.dismiss();
              }
            }}
          />
          <Button
            size="icon-sm"
            variant="secondary"
            tooltip="Insert link"
            disabled={!input().trim()}
            onClick={submit}
          >
            <CheckIcon class="size-4" />
          </Button>
        </>
      );
    },
  });
}
