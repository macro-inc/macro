import { Popover } from '@kobalte/core/popover';
import PlayIcon from '@phosphor/play.svg';
import XIcon from '@phosphor/x.svg';
import { createSignal, Show } from 'solid-js';
import type { ViewGuide } from '../core/viewGuides';

export function ViewGuideCard(props: {
  guide: ViewGuide;
  dismissed: boolean;
  connected: boolean;
  onDismiss: () => void;
  onConnect: () => void;
  onImport?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [step, setStep] = createSignal(0);
  const current = () => props.guide.steps[step()];
  return (
    <div class="flex flex-wrap items-center gap-2 border-b border-edge-muted px-4 py-2 text-xs text-ink-muted">
      <Show
        when={!props.dismissed && !props.connected && props.guide.connector}
      >
        <div class="flex min-w-0 items-center gap-1 rounded-full border border-edge-muted bg-surface pl-3 pr-1">
          <button
            type="button"
            onClick={props.onConnect}
            class="truncate py-1.5 text-ink"
          >
            Connect {props.guide.connector}
          </button>
          <button
            type="button"
            aria-label="Hide connection suggestion"
            title="Hide connection suggestion"
            onClick={props.onDismiss}
            class="rounded-full p-1.5 hover:bg-hover"
          >
            <XIcon class="size-3" />
          </button>
        </div>
      </Show>
      <Show when={!props.dismissed && props.onImport}>
        <div class="flex items-center rounded-full border border-edge-muted pr-1">
          <button
            type="button"
            onClick={props.onImport}
            class="rounded-full px-3 py-1.5 text-ink"
          >
            Import from Linear
          </button>
          <button
            type="button"
            aria-label="Hide import suggestion"
            onClick={props.onDismiss}
            class="rounded-full p-1.5 hover:bg-hover"
          >
            <XIcon class="size-3" />
          </button>
        </div>
      </Show>
      <Popover
        open={open()}
        onOpenChange={(value) => {
          if (value) setStep(0);
          setOpen(value);
        }}
        placement="bottom-start"
        gutter={8}
      >
        <Popover.Trigger class="flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-hover">
          <PlayIcon class="size-3" />
          Explore {props.guide.title}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="z-modal w-80 max-w-[calc(100vw-24px)] rounded-2xl border border-edge bg-dialog p-5 text-ink shadow-xl outline-none">
            <div class="mb-5 flex items-center justify-between">
              <p class="text-[10px] uppercase tracking-widest text-ink-muted">
                A quick tour · {step() + 1} of {props.guide.steps.length}
              </p>
              <Popover.CloseButton
                aria-label="Close tour"
                class="rounded-full p-1 hover:bg-hover"
              >
                <XIcon class="size-4" />
              </Popover.CloseButton>
            </div>
            <div aria-live="polite">
              <Popover.Title class="text-lg font-medium tracking-tight">
                {current().title}
              </Popover.Title>
              <Popover.Description class="mt-2 text-sm leading-6 text-ink-muted">
                {current().description}
              </Popover.Description>
            </div>
            <div class="mt-5 flex items-center justify-between">
              <button
                type="button"
                disabled={step() === 0}
                onClick={() => setStep((value) => value - 1)}
                class="rounded-full px-3 py-2 text-xs disabled:opacity-30"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() =>
                  step() === props.guide.steps.length - 1
                    ? setOpen(false)
                    : setStep((value) => value + 1)
                }
                class="rounded-full bg-ink px-5 py-2 text-xs font-medium text-surface"
              >
                {step() === props.guide.steps.length - 1 ? 'Got it' : 'Next'}
              </button>
            </div>
            <p class="mt-4 border-t border-edge-muted pt-3 text-[10px] leading-4 text-ink-extra-muted">
              {props.guide.title} video walkthrough · Coming soon
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </div>
  );
}
