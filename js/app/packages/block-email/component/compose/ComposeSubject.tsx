import { isMobile } from '@core/mobile/isMobile';
import { cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useCompose } from './ComposeContext';

function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function ComposeSubject(props: {
  inputRef?: (el: HTMLElement) => void;
}) {
  const ctx = useCompose();

  // On mobile the subject wraps and grows while edited, and folds to a single
  // truncated line on blur so the body starts near the top.
  const [editing, setEditing] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  const showSummary = () =>
    isMobile() && !editing() && ctx.subject().length > 0;

  return (
    <div
      class={cn(
        'w-full flex gap-2 border-b border-edge-muted focus-within:border-accent py-2',
        isMobile() ? 'items-start' : 'items-center'
      )}
    >
      <div
        class={cn(
          'text-sm shrink-0 text-ink-placeholder',
          isMobile() ? 'min-h-7 flex items-center' : 'w-14'
        )}
      >
        {isMobile() ? 'Subject:' : 'Subject'}
      </div>
      <div class="flex-1 min-w-0">
        <Show
          when={isMobile()}
          fallback={
            <input
              ref={props.inputRef}
              type="text"
              value={ctx.subject()}
              placeholder="Subject"
              class="w-full resize-none text-sm placeholder:text-ink-placeholder p-1"
              onInput={(e) => ctx.setSubject(e.currentTarget.value)}
              disabled={ctx.disabled()}
            />
          }
        >
          <Show
            when={!showSummary()}
            fallback={
              <button
                type="button"
                class="ph-no-capture w-full min-h-7 flex items-center text-sm text-ink text-left"
                onClick={() => {
                  setEditing(true);
                  requestAnimationFrame(() => textareaRef?.focus());
                }}
              >
                <span class="truncate">{ctx.subject()}</span>
              </button>
            }
          >
            <textarea
              ref={(el) => {
                textareaRef = el;
                props.inputRef?.(el);
                requestAnimationFrame(() => autosize(el));
              }}
              rows="1"
              value={ctx.subject()}
              class="w-full resize-none overflow-hidden text-sm p-1"
              onInput={(e) => {
                ctx.setSubject(e.currentTarget.value.replace(/\n/g, ' '));
                autosize(e.currentTarget);
              }}
              onFocus={() => setEditing(true)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              disabled={ctx.disabled()}
            />
          </Show>
        </Show>
      </div>
      <Show when={ctx.validationError('no_subject')}>
        {(err) => (
          <div class="text-failure-ink text-sm mt-1">{err().message}</div>
        )}
      </Show>
    </div>
  );
}
