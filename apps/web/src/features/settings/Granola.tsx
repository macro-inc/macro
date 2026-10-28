import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { fireAndForget } from '@core/util/fireAndForget';
import { Match, Switch } from 'solid-js';
import {
  GRANOLA_APP_SLUG,
  GRANOLA_ICON_URL,
} from '../granola-connect/core/granola';
import { createGranolaConnection } from '../granola-connect/primitives/create-granola-connection';
import { ConnectAction, StatusDot } from './integration-ui';
import { IntegrationRow, SettingsCard } from './primitives';

/** Granola as a Connected-accounts card; connecting starts call import. */
export function GranolaCard() {
  const granola = createGranolaConnection();

  return (
    <SettingsCard>
      <IntegrationRow
        icon={
          <PipedreamConnectorIcon
            appSlug={GRANOLA_APP_SLUG}
            iconUrl={GRANOLA_ICON_URL}
            class="size-5"
          />
        }
        title="Granola"
        description="Import your Granola meetings into Calls."
        status={
          <Switch>
            <Match when={granola.status() === 'connected'}>
              <StatusDot state="connected" label="Connected" />
            </Match>
            <Match when={granola.status() === 'disabled'}>
              <StatusDot state="attention" label="Paused" />
            </Match>
          </Switch>
        }
      >
        <Switch fallback={<span class="text-xs text-ink-muted">Loading…</span>}>
          <Match when={granola.status() === 'connected'}>
            <ConnectAction
              label="Disconnect"
              variant="danger"
              onClick={() =>
                fireAndForget(granola.disconnect(), 'granola-settings')
              }
              disabled={granola.disconnecting()}
            />
          </Match>
          <Match when={granola.status() === 'disabled'}>
            <ConnectAction
              label="Resume"
              onClick={() =>
                fireAndForget(granola.connect(), 'granola-settings')
              }
              loading={granola.connecting()}
            />
          </Match>
          <Match when={granola.status() === 'available'}>
            <ConnectAction
              label="Connect"
              onClick={() =>
                fireAndForget(granola.connect(), 'granola-settings')
              }
              loading={granola.connecting()}
            />
          </Match>
        </Switch>
      </IntegrationRow>
    </SettingsCard>
  );
}
