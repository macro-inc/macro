import { Popover } from '@kobalte/core/popover';
import DownloadIcon from '@phosphor/download-simple.svg';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import type { AppUpdate } from './app-update';

const DISMISSED_KEY = 'macro:app-update-dismissed';

/** A comet on the circle's edge: a bright head trailing a tail that fades out. */
const COMET = {
  background:
    'conic-gradient(from 0deg, transparent 0deg 140deg, color-mix(in oklch, var(--color-accent) 20%, transparent) 250deg, var(--color-accent) 350deg, transparent 360deg)',
} as const;

/** Masks a box to a ring `width` px thick along its edge. */
const ring = (width: number) => ({
  mask: `radial-gradient(farthest-side, transparent calc(100% - ${width}px), #000 calc(100% - ${width - 0.5}px))`,
});

function dismissedUpdate(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function dismissUpdate(id: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, id);
  } catch {
    // Storage can be unavailable; the popover just opens again next time.
  }
}

/**
 * The rail's update button: a download glyph in a subtle accent circle that a
 * glowing comet circles every few seconds. Its popover opens by itself once per update, until it is
 * dismissed; mount one per update id so a new update opens it again.
 */
export function UpdateButton(props: { update: () => AppUpdate }) {
  const [open, setOpen] = createSignal(dismissedUpdate() !== props.update().id);

  const onOpenChange = (next: boolean) => {
    if (!next && props.update().busy) return;
    setOpen(next);
    if (!next) dismissUpdate(props.update().id);
  };

  return (
    <Popover
      open={open()}
      onOpenChange={onOpenChange}
      placement="right-end"
      gutter={8}
    >
      <Popover.Trigger
        as={Button}
        variant="ghost"
        size="icon-md"
        class="size-10 cursor-default rounded-xl"
        label="Update available"
        draggable={false}
        data-sidebar-next-item="app-update"
      >
        <span class="pointer-events-none relative flex size-7 items-center justify-center rounded-full bg-accent-bg text-accent">
          {/* Halo under the comet, then the comet itself, flush with the circle. */}
          <span
            aria-hidden="true"
            class="absolute -inset-1 rounded-full opacity-0 blur-[3px] animate-update-glow motion-reduce:hidden"
            style={{ ...COMET, ...ring(5) }}
          />
          <span
            aria-hidden="true"
            class="absolute -inset-0.5 rounded-full opacity-0 animate-update-glow motion-reduce:hidden"
            style={{ ...COMET, ...ring(2) }}
          />
          <DownloadIcon class="size-4" aria-hidden="true" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="z-modal w-64 rounded-xl border border-edge-muted bg-menu p-4 shadow-xl outline-none animate-menu-open"
          aria-busy={props.update().busy}
        >
          <Popover.Title class="text-sm font-semibold text-ink">
            {props.update().title}
          </Popover.Title>
          <Popover.Description class="mt-1 text-sm leading-5 text-ink-muted">
            {props.update().description}
          </Popover.Description>
          <div class="mt-3 flex justify-end">
            <Button
              variant="cta"
              size="sm"
              disabled={props.update().busy}
              onClick={() => props.update().apply()}
            >
              {props.update().actionLabel}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
