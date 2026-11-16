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
export function MobileProjectDescription(
  props: ParentProps<{
    availableHeight?: number;
    ref?: (element: HTMLDivElement) => void;
  }>
) {
  const [content, setContent] = createSignal<HTMLDivElement>();
  const [empty, setEmpty] = createSignal(true);
  const clamp = createDescriptionClamp();
  const measure = () => {
    const current = content();
    if (!current) return;
    // The collaborative editor renders this placeholder only when Lexical is empty.
    const editor = current.querySelector<HTMLElement>('[role="textbox"]');
    const hasPlaceholder = !!current.querySelector(
      '[role="textbox"] ~ .text-ink-placeholder'
    );
    setEmpty(!editor || hasPlaceholder);
    if (!editor || hasPlaceholder) {
      clamp.measure(0, 1);
      return;
    }
    const lineHeight = Number.parseFloat(getComputedStyle(current).lineHeight);
    clamp.measure(
      Math.max(current.scrollHeight, editor.scrollHeight),
      lineHeight,
      props.availableHeight === undefined
        ? undefined
        : props.availableHeight - 24
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
  createEffect(measure);
  return (
    <div
      ref={props.ref}
      class="mb-6"
      style={{ '--description-lines': clamp.lines() }}
    >
      <div
        onFocusIn={clamp.expand}
        classList={{
          'max-h-[calc(var(--description-lines)*1lh)] overflow-hidden [&_[role=textbox]]:line-clamp-[var(--description-lines)]':
            !empty() && !clamp.expanded(),
        }}
        class="text-base leading-relaxed"
      >
        <div
          ref={setContent}
          class="leading-relaxed [&>div]:min-h-0 [&>div]:mt-0 [&_[contenteditable]]:leading-relaxed [&_p]:my-0 [&_[role=textbox]~.text-ink-placeholder]:static"
        >
          {props.children}
        </div>
      </div>
      <Show when={!empty() && clamp.overflowing()}>
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
