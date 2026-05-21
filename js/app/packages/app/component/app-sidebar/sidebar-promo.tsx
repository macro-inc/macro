import XIcon from '@phosphor/x.svg';
import ClockIcon from '@phosphor/clock.svg';
import { Button, cn, Surface } from '@ui';
import {
  type Component,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const PROMO_HINT_DURATION_MS = 8000;

type SidebarPromoCardAction = {
  label: string;
  onClick: () => void;
};

type SidebarPromoCardProps = {
  label: string;
  description: string;
  onDismiss: () => void;
  icon: Component<{ triggerAnimation?: boolean; class?: string }>;
  onClick?: () => void;
  primaryAction?: SidebarPromoCardAction;
  secondaryAction?: SidebarPromoCardAction;
};

export const SidebarPromoCard = (props: SidebarPromoCardProps) => {
  const [hovering, setHovering] = createSignal(false);

  return (
    <section
      aria-label={props.label}
      class="relative group/promo w-full"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Surface depth={1}>
        <Dynamic
          component={props.onClick ? 'button' : 'div'}
          type={props.onClick ? 'button' : undefined}
          class={cn(
            'w-full text-left flex flex-col gap-1 px-2.5 py-2',
            props.onClick && 'cursor-default'
          )}
          onClick={props.onClick}
        >
          <header class="flex items-center gap-2 min-w-0">
            <div class="shrink-0 text-ink-muted [&_svg]:size-4">
              <Dynamic component={props.icon} triggerAnimation={hovering()} />
            </div>
            <h3 class="flex-1 min-w-0 text-xs font-medium text-ink leading-tight m-0">
              {props.label}
            </h3>
          </header>
          <p class="text-xs text-ink-extra-muted leading-snug m-0">
            {props.description}
          </p>
          <Show when={props.primaryAction || props.secondaryAction}>
            <div
              role="group"
              aria-label={`${props.label} actions`}
              class="flex items-center justify-end gap-1 mt-2.5"
            >
              <Show when={props.secondaryAction}>
                {(action) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      action().onClick();
                    }}
                  >
                    {action().label}
                  </Button>
                )}
              </Show>
              <Show when={props.primaryAction}>
                {(action) => (
                  <Button
                    variant="cta"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      action().onClick();
                    }}
                  >
                    {action().label}
                  </Button>
                )}
              </Show>
            </div>
          </Show>
        </Dynamic>
      </Surface>
      <div class="absolute -top-1.5 -right-1.5 opacity-0 group-hover/promo:opacity-100 transition-opacity">
        <Button
          variant="base"
          class="size-5 rounded-full p-0 bg-surface shadow-sm [&_svg]:size-2.5"
          label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            props.onDismiss();
          }}
        >
          <XIcon />
        </Button>
      </div>
    </section>
  );
};

type SidebarPromoHintProps = {
  title: string;
  message: string;
  onDone: () => void;
  secondaryAction?: SidebarPromoCardAction;
};

export const SidebarPromoHint = (props: SidebarPromoHintProps) => {
  const [fading, setFading] = createSignal(false);
  const [progressDepleted, setProgressDepleted] = createSignal(false);

  onMount(() => {
    // Kick the progress bar animation on the next frame so the
    // initial 100% width is committed before the transition starts.
    requestAnimationFrame(() => setProgressDepleted(true));
    const fadeTimer = setTimeout(
      () => setFading(true),
      PROMO_HINT_DURATION_MS - 400
    );
    const doneTimer = setTimeout(props.onDone, PROMO_HINT_DURATION_MS);
    onCleanup(() => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    });
  });

  return (
    <div
      role="status"
      aria-label={props.title}
      class={cn(
        'w-full transition-opacity duration-300',
        fading() ? 'opacity-0' : 'opacity-100'
      )}
    >
      <Surface depth={2}>
        <div
          role="progressbar"
          aria-label="Auto-dismiss countdown"
          class="h-0.5 w-full bg-edge-muted/50"
        >
          <div
            class="h-full bg-accent ease-linear"
            style={{
              width: progressDepleted() ? '0%' : '100%',
              transition: `width ${PROMO_HINT_DURATION_MS}ms linear`,
            }}
          />
        </div>
        <div class="px-2.5 py-2 flex flex-col gap-1">
          <header class="flex items-center gap-2 min-w-0">
            <ClockIcon class="shrink-0 size-4 text-ink-muted" />
            <h3 class="flex-1 min-w-0 text-xs font-medium text-ink leading-tight m-0">
              {props.title}
            </h3>
          </header>
          <p class="text-xs text-ink-extra-muted leading-snug m-0 min-h-[3lh]">
            {props.message}
          </p>
          <div class="flex items-center justify-end gap-1 mt-2.5">
            <Show when={props.secondaryAction}>
              {(action) => (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    action().onClick();
                    props.onDone();
                  }}
                >
                  {action().label}
                </Button>
              )}
            </Show>
            <Button variant="cta" size="sm" onClick={props.onDone}>
              Got it
            </Button>
          </div>
        </div>
      </Surface>
    </div>
  );
};
