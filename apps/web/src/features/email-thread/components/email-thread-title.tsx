import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { cn } from '@ui/utils/classname';
import { createEffect, createSignal, type JSX, on, Show } from 'solid-js';
import { CopySubjectButton } from './copy-subject-button';

/**
 * An open thread's subject: at most three lines, then an ellipsis and a button
 * that shows the rest.
 */
export function EmailThreadTitle(props: {
  title: string;
  onCopy?: (subject: string) => void | boolean | Promise<void | boolean>;
  copyReveal?: 'hover' | 'always';
  /** Replaces the Copy subject button after the last word. */
  trailing?: JSX.Element;
  class?: string;
}) {
  const [titleHovered, setTitleHovered] = createSignal(false);
  const copyHidden = () => props.copyReveal === 'hover' && !titleHovered();

  const [overflows, setOverflows] = createSignal(false);
  const [expandedTitle, setExpandedTitle] = createSignal<string>();
  const expanded = () => expandedTitle() === props.title;
  const controlsInCorner = () => overflows() || expanded();
  const [text, setText] = createSignal<HTMLElement>();

  // Only the clamped text says whether it overflows: expanded, its scroll and
  // client heights agree.
  const measure = () => {
    const element = text();
    if (element && !expanded())
      setOverflows(element.scrollHeight > element.clientHeight + 1);
  };
  createResizeObserver(text, measure);
  createEffect(
    on([() => props.title, expanded], () => {
      const element = text();
      if (element && !expanded()) element.scrollTop = 0;
      measure();
    })
  );

  return (
    <h1
      class={cn(
        // The padding is always there, so where the controls sit never
        // changes how the text wraps.
        'ph-no-capture relative block w-full max-w-full min-w-0 pr-16 touch:pr-11 font-semibold tracking-tight text-ink select-text cursor-text leading-snug',
        props.class
      )}
      onMouseEnter={() => setTitleHovered(true)}
      onMouseLeave={() => setTitleHovered(false)}
    >
      <span
        ref={setText}
        class={cn(
          'text-pretty wrap-anywhere',
          expanded()
            ? 'block not-touch:max-h-[40dvh] not-touch:overflow-y-auto'
            : 'line-clamp-3'
        )}
      >
        <span class="select-text">
          {props.title}
          {/* Out of flow: after the last word of a subject that fits, in the
              bottom corner of one that doesn't. */}
          <span
            class={cn(
              'absolute ml-1.5 inline-flex select-none items-center',
              controlsInCorner() ? 'right-0 bottom-0 touch:flex-col' : 'h-[1lh]'
            )}
          >
            <Show
              when={props.trailing}
              fallback={
                <CopySubjectButton
                  subject={props.title}
                  onCopy={props.onCopy}
                  class={cn(
                    'text-inherit transition-opacity duration-150 ease',
                    copyHidden() ? 'opacity-0' : 'opacity-100'
                  )}
                />
              }
            >
              {props.trailing}
            </Show>
            <Show when={controlsInCorner()}>
              <Button
                variant="ghost"
                size="icon-sm"
                class="text-inherit"
                aria-expanded={expanded()}
                aria-label={t(
                  expanded()
                    ? 'emailThread.showLess'
                    : 'emailThread.showFullSubject'
                )}
                tooltip={t(
                  expanded()
                    ? 'emailThread.showLess'
                    : 'emailThread.showFullSubject'
                )}
                onClick={() =>
                  setExpandedTitle(expanded() ? undefined : props.title)
                }
              >
                <CaretDownIcon
                  class={cn(
                    'size-3.5 transition-transform motion-reduce:transition-none',
                    expanded() && 'rotate-180'
                  )}
                />
              </Button>
            </Show>
          </span>
        </span>
      </span>
    </h1>
  );
}
