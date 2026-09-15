import type { SettingsTab } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { Show, Suspense } from 'solid-js';
import { Account } from './Account';
import { Admin } from './Admin';
import { Agent } from './Agent';
import { Agents } from './Agents';
import { ApiKeys } from './ApiKeys';
import { Appearance } from './Appearance';
import { Billing } from './Billing';
import { Bots } from './Bots';
import { ConnectedAccounts } from './ConnectedAccounts';
import { Crm } from './Crm';
import { Harness } from './Harness';
import { MobileApp } from './MobileApp';
import { Notifications } from './Notifications';
import { Shortcuts } from './Shortcuts';
import { Tags } from './Tags';
import { Team } from './Team';

/** Shared forms for desktop panels and mobile sheet detail pages. */
export function SettingsTabContent(props: { tab: SettingsTab }) {
  const isAvailable = useSettingsTabAvailable();
  const isCurrentTab = (tab: SettingsTab) =>
    props.tab === tab && isAvailable(tab);
  return (
    <Suspense
      fallback={
        <div role="status" class="p-8 text-center text-sm text-ink-muted">
          Loading settings…
        </div>
      }
    >
      <Show when={isCurrentTab('Account')}>
        <Account />
      </Show>
      <Show when={isCurrentTab('API Keys')}>
        <ApiKeys />
      </Show>
      <Show when={isCurrentTab('Notifications')}>
        <Notifications />
      </Show>
      <Show when={isCurrentTab('Billing')}>
        <Billing />
      </Show>
      <Show when={isCurrentTab('Appearance')}>
        <Appearance />
      </Show>
      <Show when={isCurrentTab('Shortcuts')}>
        <Shortcuts />
      </Show>
      <Show when={isCurrentTab('Team')}>
        <Team />
      </Show>
      <Show when={isCurrentTab('Tags')}>
        <Tags />
      </Show>
      <Show when={isCurrentTab('CRM')}>
        <Crm />
      </Show>
      <Show when={isCurrentTab('Connected')}>
        <ConnectedAccounts />
      </Show>
      <Show when={isCurrentTab('Mobile App')}>
        <MobileApp />
      </Show>
      <Show when={isCurrentTab('Agent')}>
        <Agent />
      </Show>
      <Show when={isCurrentTab('Agents')}>
        <Agents />
      </Show>
      <Show when={isCurrentTab('Harness')}>
        <Harness />
      </Show>
      <Show when={isCurrentTab('Bots')}>
        <Bots />
      </Show>
      <Show when={isCurrentTab('Admin')}>
        <Admin />
      </Show>
    </Suspense>
  );
}
