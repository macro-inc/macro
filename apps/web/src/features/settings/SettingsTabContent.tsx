import type { SettingsTab } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { Show, Suspense } from 'solid-js';
import { CalendarSettings } from '../calendar/calendar-settings';
import { CrmSettings as Crm } from '../crm/crm-settings';
import { SchedulingSettings } from '../scheduling/scheduling';
import { Usage } from '../usage/usage';
import { Account } from './Account';
import { Admin } from './Admin';
import { Agent } from './Agent';
import { AgentSettings } from './AgentSettings';
import { ApiKeys } from './ApiKeys';
import { Appearance } from './Appearance';
import { Billing } from './Billing';
import { Bots } from './Bots';
import { ConnectedAccounts } from './ConnectedAccounts';
import { DesktopApp } from './DesktopApp';
import { EmailSettings } from './email-settings';
import { McpConnections } from './McpConnections';
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
      <Show when={isCurrentTab('Email')}>
        <EmailSettings />
      </Show>
      <Show when={isCurrentTab('Calendar')}>
        <CalendarSettings />
      </Show>
      <Show when={isCurrentTab('Booking links')}>
        <SchedulingSettings />
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
      <Show when={isCurrentTab('Usage')}>
        <Usage />
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
      <Show when={isCurrentTab('Connections')}>
        <McpConnections />
      </Show>
      <Show when={isCurrentTab('Desktop App')}>
        <DesktopApp />
      </Show>
      <Show when={isCurrentTab('Mobile App')}>
        <MobileApp />
      </Show>
      <Show when={isCurrentTab('Agent')}>
        <Agent />
      </Show>
      <Show when={isCurrentTab('Agents')}>
        <AgentSettings />
      </Show>
      <Show when={isCurrentTab('Harness')}>
        <AgentSettings initialSection="runtimes" />
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
