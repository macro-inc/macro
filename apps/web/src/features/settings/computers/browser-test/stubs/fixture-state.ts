import type { NotifEvent } from '@service-notification/generated/schemas/notifEvent';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { createSignal } from 'solid-js';

/** What a computer setup notification carries. */
export type ComputerSetupContent = Extract<
  NotifEvent,
  { tag: 'computer_setup' }
>['content'];

/** The computer's runtime, once the test says it registered. */
export const [harnesses, setHarnesses] = createSignal<RegisteredHarness[]>([]);

export type FixtureAgent = {
  bot: { id: string; name: string };
  harness_id: string | null;
};
export const [agents, setAgents] = createSignal<FixtureAgent[]>([]);

export const [settingsOpened, setSettingsOpened] = createSignal<string>();

/** The Agents page Try it opened, with the params it passed. */
export type AgentsPageOpened = {
  page: string;
  params: Record<string, unknown>;
};
export const [agentsPageOpened, setAgentsPageOpened] =
  createSignal<AgentsPageOpened>();

declare global {
  interface Window {
    computerFixture: {
      setHarnesses: typeof setHarnesses;
      setAgents: typeof setAgents;
      settingsOpened: typeof settingsOpened;
      agentsPageOpened: typeof agentsPageOpened;
      setAgentsPageOpened: typeof setAgentsPageOpened;
      setSettingsOpened: typeof setSettingsOpened;
      /** Set by the fixture once its notice code loads. */
      notify: (content: ComputerSetupContent) => Promise<void>;
    };
  }
}

window.computerFixture = {
  setHarnesses,
  setAgents,
  settingsOpened,
  agentsPageOpened,
  setAgentsPageOpened,
  setSettingsOpened,
  notify: async () => {},
};
