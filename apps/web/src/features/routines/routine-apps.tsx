import { Popover } from '@kobalte/core/popover';
import PlugsIcon from '@phosphor/plugs.svg';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import { badgeTriggerClasses } from '@ui';
import { type Accessor, Show } from 'solid-js';
import { PipedreamAppPicker } from '../settings/PipedreamAppPicker';
import type { RoutineApp } from './core/draft';

/** The viewer's connected app slugs, undefined until they load. */
export function createRoutineConnectedApps(): Accessor<
  ReadonlySet<string> | undefined
> {
  const connections = usePipedreamConnectedSlugs();
  return () => (connections.ready() ? connections.slugs() : undefined);
}

/** Apps a routine requires, picked from the Pipedream catalog. */
export function RoutineApps(props: {
  apps: RoutineApp[];
  onChange: (apps: RoutineApp[]) => void;
}) {
  const connections = usePipedreamConnectedSlugs();
  let triggerRef: HTMLButtonElement | undefined;
  // Mount Connect inside the enclosing dialog so its focus trap allows it.
  const dialog = () =>
    triggerRef?.closest<HTMLElement>('[role="dialog"]') ?? undefined;
  const missing = () =>
    connections.ready() &&
    props.apps.some((app) => !connections.slugs().has(app.app_slug));
  const label = () =>
    props.apps.length === 0
      ? 'Add apps'
      : props.apps.map((app) => app.server_name).join(', ');

  return (
    <Popover
      placement="bottom-start"
      gutter={6}
      boundary={() => document.documentElement}
    >
      <Popover.Trigger
        ref={triggerRef}
        aria-label={
          props.apps.length === 0 ? 'Add required apps' : 'Required apps'
        }
        title={missing() ? 'Connect every app this routine requires' : label()}
        class={badgeTriggerClasses({
          variant: 'outline',
          size: 'sm',
          class: 'min-w-0 max-w-full text-left text-ink-muted',
        })}
      >
        <PlugsIcon class="size-3 shrink-0" />
        <span class="min-w-0 truncate">{label()}</span>
        <Show when={missing()}>
          <span
            aria-hidden="true"
            class="size-1.5 shrink-0 rounded-full bg-failure"
          />
        </Show>
      </Popover.Trigger>
      <Popover.Portal
        mount={dialog()}
        ref={(element) => {
          element.style.display = 'contents';
        }}
      >
        <Popover.Content
          class="menu-surface z-modal flex max-h-[min(32rem,var(--kb-popper-content-available-height))] w-96 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto overscroll-contain p-3"
          onKeyDown={(e) => e.stopPropagation()}
          // A pick removes the tapped result, so focus falls out of the popover.
          onFocusOutside={(event) => event.preventDefault()}
        >
          <Popover.Title class="text-sm font-medium">
            Required apps
          </Popover.Title>
          <Popover.Description class="mb-3 mt-1 text-xs text-ink-muted">
            Every run gets these apps on top of the agent's own. Connect each
            one before the routine can be saved or run.
          </Popover.Description>
          <PipedreamAppPicker
            selected={props.apps}
            onChange={props.onChange}
            connectedSlugs={connections.slugs}
            connectionsReady={connections.ready}
            connectContainer={dialog}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
