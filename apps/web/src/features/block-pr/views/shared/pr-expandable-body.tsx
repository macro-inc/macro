import { t } from '@app/lib/i18n';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, cn } from '@ui';
import { createSignal, createUniqueId, type ParentProps, Show } from 'solid-js';
import { createStore } from 'solid-js/store';

/** Measure the full body, so clipping never prevents later Markdown or images from being observed. */
export function PrExpandableBody(props: ParentProps<{ class?: string }>) {
  const id = createUniqueId();
  const [content, setContent] = createSignal<HTMLDivElement>();
  const [state, setState] = createStore({
    expanded: false,
    overflowing: false,
  });
  createResizeObserver(content, () => {
    const element = content();
    if (!element) return;
    const limit = Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--pr-body-limit')
    );
    setState('overflowing', element.scrollHeight > limit + 40);
  });
  return (
    <div
      class={cn(
        'flex min-w-0 flex-col gap-2 [--pr-body-limit:180px]',
        props.class
      )}
    >
      <div
        id={id}
        class={cn(
          'relative',
          !state.expanded &&
            state.overflowing &&
            'max-h-(--pr-body-limit) overflow-hidden [mask-image:linear-gradient(black_calc(100%-40px),transparent)]'
        )}
      >
        <div ref={setContent}>{props.children}</div>
      </div>
      <Show when={state.overflowing}>
        <div>
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={state.expanded}
            aria-controls={id}
            onClick={() => setState('expanded', !state.expanded)}
          >
            {state.expanded ? t('prPage.showLess') : t('prPage.showMore')}
          </Button>
        </div>
      </Show>
    </div>
  );
}
