import { Panel } from '@ui';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * Shared chrome for the spare, single-purpose integration panels (Email,
 * GitHub) nested under the Workspace settings group. Mirrors the Account
 * panel's centered, max-width column so the settings panels feel consistent.
 */
export function IntegrationPanelShell(props: {
  title: string;
  children: JSX.Element;
}) {
  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div class="max-w-200 size-full">
        <Panel depth={2} class="h-full overflow-hidden text-ink">
          <Panel.Header class="px-6">
            <div class="text-sm font-semibold">{props.title}</div>
          </Panel.Header>
          <Panel.Body scroll class="text-ink">
            {props.children}
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}

/**
 * Generous, centered hero used as the resting state of an integration panel:
 * an icon tile, a title, a one-line explanation, an optional status pill and
 * the primary action(s). Leans on whitespace rather than filler to make a
 * sparse page feel intentional.
 */
export function ConnectionHero(props: {
  icon: Component<{ class?: string }>;
  title: string;
  description: string;
  status?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <div class="flex flex-col items-center text-center gap-5 px-6 pt-20 pb-12">
      <div class="flex size-16 items-center justify-center rounded-2xl bg-edge-muted">
        <Dynamic component={props.icon} class="size-8 text-ink" />
      </div>
      <div class="flex flex-col items-center gap-2 max-w-100">
        <div class="text-lg font-semibold text-ink">{props.title}</div>
        <p class="text-sm/relaxed text-ink-muted">{props.description}</p>
      </div>
      <Show when={props.status}>{props.status}</Show>
      <Show when={props.children}>
        <div class="flex items-center gap-2 pt-1">{props.children}</div>
      </Show>
    </div>
  );
}

export type ConnectionState = 'connected' | 'attention' | 'disconnected';

/** Small dot-and-label pill conveying an integration's connection state. */
export function StatusPill(props: { state: ConnectionState; label: string }) {
  return (
    <span
      class="inline-flex items-center gap-1.5 rounded-full border border-edge-muted bg-surface px-2.5 py-1 text-xs font-medium"
      classList={{
        'text-success': props.state === 'connected',
        'text-failure': props.state === 'attention',
        'text-ink-muted': props.state === 'disconnected',
      }}
    >
      <span class="size-1.5 rounded-full bg-current" />
      {props.label}
    </span>
  );
}
