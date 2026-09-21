import {
  DiscussionComposer,
  type DiscussionThread,
  DiscussionThreadView,
} from '@core/comments/discussion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { floatWithElement } from '@core/component/LexicalMarkdown/directive/floatWithElement';
import { ScopedPortal } from '@core/component/ScopedPortal';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { For, Show } from 'solid-js';

false && floatWithElement;

/** Same thread/reply controls as the sidebar, anchored beside a cell. */
export function SpreadsheetCommentCard(props: {
  element: HTMLElement;
  label: string;
  creating: boolean;
  threads: DiscussionThread[];
  onEnter: () => void;
  onLeave: () => void;
  onInteract: () => void;
  onClose: () => void;
}) {
  return (
    <ScopedPortal>
      <div
        role="dialog"
        aria-label={`Comments on ${props.label}`}
        class="absolute z-modal w-88 max-w-[calc(100vw-24px)] rounded-xl border border-edge bg-panel text-ink shadow-xl"
        use:floatWithElement={{
          element: () => props.element,
          spacing: 6,
          floatingOptions: { placement: 'right-start' },
        }}
        onMouseEnter={props.onEnter}
        onMouseLeave={props.onLeave}
        onPointerDown={props.onInteract}
        onFocusIn={props.onInteract}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onClose();
          }
        }}
      >
        <div class="flex items-center justify-between border-b border-edge-muted px-3 py-2">
          <span class="text-xs font-medium">{props.label}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close cell comment"
            onClick={props.onClose}
          >
            <XIcon class="size-4" />
          </Button>
        </div>
        <div class="max-h-[min(28rem,65dvh)] overflow-y-auto p-3 text-xs">
          <StaticMarkdownContext>
            <For each={props.threads}>
              {(thread) => (
                <DiscussionThreadView showReplyAction thread={thread} />
              )}
            </For>
            <Show when={props.creating}>
              <DiscussionComposer autofocus />
            </Show>
          </StaticMarkdownContext>
        </div>
      </div>
    </ScopedPortal>
  );
}
