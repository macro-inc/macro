import { createConnectAction } from '@core/connectors/connect-action';
import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Popover } from '@kobalte/core/popover';
import PlugsIcon from '@phosphor/plugs.svg';
import { appConnectorKey, useConnectors } from '@queries/connectors';
import { Button, badgeTriggerClasses } from '@ui';
import { type Accessor, Show } from 'solid-js';
import { ConnectorAppPicker } from '../settings/ConnectorAppPicker';
import { ConnectAction } from '../settings/integration-ui';
import type { RoutineApp } from './core/draft';

/** The viewer's connected app slugs, undefined until they load. */
export function createRoutineConnectedApps(): Accessor<
  ReadonlySet<string> | undefined
> {
  const connectors = useConnectors();
  return () => (connectors.ready() ? connectors.connectedApps() : undefined);
}

/** Apps a routine requires, picked from the connector catalog. */
export function RoutineApps(props: {
  apps: RoutineApp[];
  onChange: (apps: RoutineApp[]) => void;
  /** A chip listing the apps (default), or an "Add connection" button. */
  variant?: 'chip' | 'button';
}) {
  const connectors = useConnectors();
  let triggerRef: HTMLButtonElement | undefined;
  // Mount Connect inside the enclosing dialog so its focus trap allows it.
  const dialog = () =>
    triggerRef?.closest<HTMLElement>('[role="dialog"]') ?? undefined;
  const missing = () =>
    connectors.ready() &&
    props.apps.some((app) => !connectors.connectedApps().has(app.app_slug));
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
      <Show
        when={props.variant === 'button'}
        fallback={
          <Popover.Trigger
            ref={triggerRef}
            aria-label={
              props.apps.length === 0 ? 'Add required apps' : 'Required apps'
            }
            title={
              missing() ? 'Connect every app this routine requires' : label()
            }
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
        }
      >
        <Popover.Trigger
          as={Button}
          ref={triggerRef}
          variant="secondary"
          size="sm"
        >
          <PlusIcon class="size-3.5" />
          Add connection
        </Popover.Trigger>
      </Show>
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
            {props.variant === 'button' ? 'Connections' : 'Required apps'}
          </Popover.Title>
          <Popover.Description class="mb-3 mt-1 text-xs text-ink-muted">
            Every run gets these apps on top of the agent's own. Connect each
            one before the routine can be saved or run.
          </Popover.Description>
          <ConnectorAppPicker
            selected={props.apps}
            onChange={props.onChange}
            connectedSlugs={connectors.connectedApps}
            connectionsReady={connectors.ready}
            connectContainer={dialog}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/**
 * Connects one app a routine requires that the viewer hasn't connected; the
 * row shows it connected once it is.
 */
export function RoutineConnectApp(props: { app: RoutineApp }) {
  let anchor: HTMLSpanElement | undefined;
  // Mount Connect inside the enclosing dialog so its focus trap allows it.
  const dialog = () =>
    anchor?.closest<HTMLElement>('[role="dialog"]') ?? undefined;
  const { connect, busy } = createConnectAction({
    key: () => appConnectorKey(props.app.app_slug),
    name: () => props.app.server_name,
    container: dialog,
  });
  return (
    <span ref={anchor} class="contents">
      <ConnectAction
        label="Connect"
        ariaLabel={`Connect ${props.app.server_name}`}
        loading={busy()}
        onClick={() => fireAndForget(connect(), 'routines')}
      />
    </span>
  );
}
