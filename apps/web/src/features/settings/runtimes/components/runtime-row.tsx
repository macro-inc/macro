import { type JSX, Show } from 'solid-js';
import { HarnessIcon } from '../../integration-ui';

/** Compact runtime summary; configuration is composed by the owner. */
export function RuntimeRow(props: {
  name: string;
  description: string;
  icon: JSX.Element;
  status?: string;
  connected?: boolean;
  action?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <section aria-label={`${props.name} runtime`} class="px-5 py-4 mobile:px-4">
      <div class="flex items-start gap-3">
        <HarnessIcon>{props.icon}</HarnessIcon>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 class="text-sm font-medium text-ink">{props.name}</h2>
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
            <Show when={props.action}>
              <div class="shrink-0">{props.action}</div>
            </Show>
          </div>
          <p class="mt-1 text-xs leading-5 text-ink-muted">
            {props.description}
          </p>
        </div>
      </div>
      {props.children}
    </section>
  );
}
