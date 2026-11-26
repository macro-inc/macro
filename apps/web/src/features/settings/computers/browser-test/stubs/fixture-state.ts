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

/** The agent whose DM Chat with opened, by bot id. */
export const [agentDmOpened, setAgentDmOpened] = createSignal<string>();

/**
 * How the computer's runtime answers Claude sign-out: `ok`, `rollout_disabled`
 * as the harness does for an account outside the computers rollout, or
 * `forbidden` for a caller without manage rights.
 */
export const claudeAnswers = {
  signOut: 'ok' as 'ok' | 'rollout_disabled' | 'forbidden',
  signOutCalls: 0,
};

declare global {
  interface Window {
    computerFixture: {
      setHarnesses: typeof setHarnesses;
      setAgents: typeof setAgents;
      settingsOpened: typeof settingsOpened;
      setSettingsOpened: typeof setSettingsOpened;
      claude: typeof claudeAnswers;
      /** Set by the fixture once its notice code loads. */
      notify: (content: ComputerSetupContent) => Promise<void>;
    };
  }
}

window.computerFixture = {
  setHarnesses,
  setAgents,
  settingsOpened,
  setSettingsOpened,
  claude: claudeAnswers,
  notify: async () => {},
};
