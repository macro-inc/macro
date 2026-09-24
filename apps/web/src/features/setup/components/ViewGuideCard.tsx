import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import XIcon from '@phosphor/x.svg';
import { createMediaQuery } from '@solid-primitives/media';
import { createSignal, createUniqueId, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { ViewGuide, ViewGuideStep } from '../core/viewGuides';
import { createGuidePosition } from '../primitives/createGuidePosition';
import './view-guide.css';
import { ViewGuideVideoPlayer } from './ViewGuideVideoPlayer';

/** An automatic, non-modal flyover scoped to its view (including split panes). */
export function ViewGuideCard(props: {
  guide: ViewGuide;
  dismissed: boolean;
  connected: boolean;
  onDismiss: () => void;
  onConnect: () => void;
  onImport?: () => void;
  onStepChange?: (step: ViewGuideStep) => void;
}) {
  const desktop = createMediaQuery('(min-width: 768px) and (pointer: fine)');
  return (
    <Show when={desktop() && !props.dismissed}>
      <ActiveGuide {...props} />
    </Show>
  );
}

function ActiveGuide(props: Parameters<typeof ViewGuideCard>[0]) {
  const [step, setStep] = createSignal(0);
  const [anchor, setAnchor] = createSignal<HTMLDivElement>();
  const [card, setCard] = createSignal<HTMLElement>();
  const titleId = createUniqueId();
  const current = () => props.guide.steps[step()];
  const { position, highlight } = createGuidePosition(anchor, card, current);
  const goTo = (index: number) => {
    setStep(index);
    props.onStepChange?.(props.guide.steps[index]);
  };
  onMount(() => props.onStepChange?.(current()));
  return (
    <>
      <div ref={setAnchor} class="h-0 w-full shrink-0" data-view-guide-anchor />
      <Portal>
        <Show when={position().ready && highlight()}>
          {(rect) => (
            <div
              aria-hidden="true"
              class="view-guide-highlight"
              style={{
                left: `${rect().left}px`,
                top: `${rect().top}px`,
                width: `${rect().width}px`,
                height: `${rect().height}px`,
              }}
            />
          )}
        </Show>
        <aside
          ref={setCard}
          data-view-guide-card
          aria-label={`${props.guide.title} quick tour`}
          aria-describedby={titleId}
          class="view-guide-card fixed left-0 top-0 z-[70] w-80 max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-edge bg-dialog p-5 text-ink"
          style={{
            transform: `translate3d(${position().left}px, ${position().top}px, 0)`,
            visibility: position().ready ? 'visible' : 'hidden',
            'max-width': `${position().maxWidth}px`,
            'max-height': `${position().maxHeight}px`,
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              props.onDismiss();
            }
          }}
        >
          <div class="mb-5 flex items-center gap-2">
            <p class="mr-auto text-[10px] uppercase tracking-widest text-ink-muted">
              {props.guide.title} tour
            </p>
            <nav
              aria-label="Tour steps"
              class="flex shrink-0 items-center gap-0.5 text-ink-muted"
            >
              <button
                type="button"
                aria-label="Back"
                title="Previous step"
                disabled={step() === 0}
                onClick={() => goTo(step() - 1)}
                class="rounded-full p-1.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-25 disabled:hover:bg-transparent"
              >
                <CaretLeftIcon class="size-3.5" aria-hidden="true" />
              </button>
              <span
                class="min-w-8 text-center text-[10px] tabular-nums"
                aria-live="polite"
              >
                {step() + 1} / {props.guide.steps.length}
              </span>
              <button
                type="button"
                aria-label="Next step"
                title="Next step"
                disabled={step() === props.guide.steps.length - 1}
                onClick={() => goTo(step() + 1)}
                class="rounded-full p-1.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-25 disabled:hover:bg-transparent"
              >
                <CaretRightIcon class="size-3.5" aria-hidden="true" />
              </button>
            </nav>
            <button
              type="button"
              aria-label={`Dismiss ${props.guide.title} tour`}
              onClick={props.onDismiss}
              class="rounded-full p-1 hover:bg-hover"
            >
              <XIcon class="size-4" />
            </button>
          </div>
          <div aria-live="polite">
            <h2 id={titleId} class="text-lg font-medium tracking-tight">
              {current().title}
            </h2>
            <p class="mt-2 text-sm leading-6 text-ink-muted">
              {current().description}
            </p>
          </div>
          <Show when={!highlight() && current().missingTarget}>
            <p class="mt-3 text-xs leading-5 text-ink-extra-muted">
              {current().missingTarget}
            </p>
          </Show>
          <Show
            when={(!props.connected && props.guide.connector) || props.onImport}
          >
            <div class="mt-4 flex flex-wrap gap-2 text-xs">
              <Show when={!props.connected && props.guide.connector}>
                <button
                  type="button"
                  onClick={props.onConnect}
                  class="rounded-full border border-edge-muted px-3 py-2 hover:bg-hover"
                >
                  Connect {props.guide.connector}
                </button>
              </Show>
              <Show when={props.onImport}>
                <button
                  type="button"
                  onClick={props.onImport}
                  class="rounded-full border border-edge-muted px-3 py-2 hover:bg-hover"
                >
                  Import from Linear
                </button>
              </Show>
            </div>
          </Show>
          <div class="mt-5 flex items-center justify-end">
            <button
              type="button"
              onClick={() =>
                step() === props.guide.steps.length - 1
                  ? props.onDismiss()
                  : goTo(step() + 1)
              }
              class="rounded-full bg-ink px-5 py-2 text-xs font-medium text-surface"
            >
              {step() === props.guide.steps.length - 1 ? 'Got it' : 'Next'}
            </button>
          </div>
          <Show when={props.guide.video} keyed>
            {(video) => <ViewGuideVideoPlayer video={video} />}
          </Show>
        </aside>
      </Portal>
    </>
  );
}
