import { type JSX, Show } from 'solid-js';
import { HarnessIcon } from '../../integration-ui';

/** Runtime summary with a single accessible trigger covering the whole row. */
export function RuntimeRow(props: {
  name: string;
  description: string;
  icon: JSX.Element;
  status?: string;
  system?: boolean;
  connected?: boolean;
  actionLabel?: string;
  disabled?: boolean;
  onConfigure?: () => void;
  triggerRef?: (element: HTMLButtonElement) => void;
}) {
  return (
    <section
      aria-label={`${props.name} runtime`}
      class="relative px-5 py-4 mobile:px-4"
      classList={{
        'hover:bg-hover focus-within:bg-hover': !!props.onConfigure,
      }}
    >
      <Show when={props.onConfigure}>
        <button
          type="button"
          ref={props.triggerRef}
          class="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-50"
          aria-label={`${props.actionLabel ?? 'Configure'} ${props.name}`}
          aria-haspopup="dialog"
          disabled={props.disabled}
          onClick={() => props.onConfigure?.()}
        />
      </Show>
      <div class="pointer-events-none flex items-start gap-3">
        <HarnessIcon>{props.icon}</HarnessIcon>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 class="text-sm font-medium text-ink">{props.name}</h2>
              <Show when={props.system}>
                <span class="rounded-md border border-accent/20 bg-accent/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                  System
                </span>
              </Show>
              <Show when={props.status}>
                <span
                  class="inline-flex items-center gap-1.5 text-[11px]"
                  classList={{
                    'text-success': props.connected,
                    'text-ink-extra-muted': !props.connected,
                  }}
                >
                  <span
                    aria-hidden="true"
                    class="size-1.5 rounded-full"
                    classList={{
                      'bg-success': props.connected,
                      'bg-ink-extra-muted': !props.connected,
                    }}
                  />
                  {props.status}
                </span>
              </Show>
            </div>
            <Show when={props.onConfigure}>
              <span
                aria-hidden="true"
                class="shrink-0 rounded-md border border-edge-muted px-2.5 py-1 text-xs font-medium text-ink-muted"
              >
                {props.actionLabel ?? 'Configure'}
              </span>
            </Show>
          </div>
          <p class="mt-1 text-xs leading-5 text-ink-muted">
            {props.description}
          </p>
        </div>
      </div>
    </section>
  );
}
