import { t } from '@app/lib/i18n';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { createEffect, createSignal, type ParentProps, Show } from 'solid-js';
import { createDescriptionClamp } from '../../primitives/create-description-clamp';

/** The editor stays mounted so disclosure never drops a collaborative edit. */
export function MobileProjectDescription(props: ParentProps) {
  const [content, setContent] = createSignal<HTMLDivElement>();
  const clamp = createDescriptionClamp();
  const measure = () => {
    const current = content();
    if (!current) return;
    const lineHeight = Number.parseFloat(getComputedStyle(current).lineHeight);
    clamp.measure(current.scrollHeight, lineHeight * 3);
  };
  // Observe natural content, not the clamped viewport: collaboration can load
  // more text without changing that viewport's three-line height.
  createResizeObserver(content, measure);
  createEffect(() => {
    if (!clamp.expanded()) measure();
  });
  return (
    <div class="mb-6">
      <div
        onFocusIn={clamp.expand}
        classList={{ 'max-h-[3lh] overflow-hidden': !clamp.expanded() }}
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
