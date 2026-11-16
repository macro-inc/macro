import { t } from '@app/lib/i18n';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createSignal,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { createDescriptionClamp } from '../../primitives/create-description-clamp';

/** The editor stays mounted so disclosure never drops a collaborative edit. */
export function MobileProjectDescription(props: ParentProps) {
  const [content, setContent] = createSignal<HTMLDivElement>();
  const clamp = createDescriptionClamp();
  const measure = () => {
    const current = content();
    if (!current) return;
    const lineHeight = Number.parseFloat(getComputedStyle(current).lineHeight);
    const editor = current.querySelector<HTMLElement>('[role="textbox"]');
    clamp.measure(
      Math.max(current.scrollHeight, editor?.scrollHeight ?? 0),
      lineHeight * 3
    );
  };
  // Collaboration can change text without resizing a clamped viewport.
  // Measure both child mutations and available width.
  createResizeObserver(content, measure);
  createEffect(() => {
    const element = content();
    if (!element) return;
    const observer = new MutationObserver(measure);
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    onCleanup(() => observer.disconnect());
  });
  createEffect(() => {
    if (!clamp.expanded()) measure();
  });
  return (
    <div class="mb-6">
      <div
        onFocusIn={clamp.expand}
        classList={{
          'max-h-[3lh] overflow-hidden [&_[role=textbox]]:line-clamp-3':
            !clamp.expanded(),
        }}
        class="text-base leading-relaxed"
      >
        <div
          ref={setContent}
          class="leading-relaxed [&>div]:min-h-0 [&>div]:mt-0 [&_[contenteditable]]:leading-relaxed [&_p]:my-0"
        >
          {props.children}
        </div>
      </div>
      <Show when={clamp.overflowing()}>
        <button
          type="button"
          class="mt-1 text-sm text-ink-muted underline"
          aria-expanded={clamp.expanded()}
          onClick={clamp.toggle}
        >
          {clamp.expanded() ? t('common.showLess') : t('common.showMore')}
        </button>
      </Show>
    </div>
  );
}
