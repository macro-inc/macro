import type { Harness as RegisteredHarness } from '@service-storage/client';
import { createSignal } from 'solid-js';

/** The computer's runtime, once the test says it registered. */
export const [harnesses, setHarnesses] = createSignal<RegisteredHarness[]>([]);

export type FixtureAgent = {
  bot: { id: string; name: string };
  harness_id: string | null;
};
export const [agents, setAgents] = createSignal<FixtureAgent[]>([]);

export const [settingsOpened, setSettingsOpened] = createSignal<string>();

declare global {
  interface Window {
    computerFixture: {
      setHarnesses: typeof setHarnesses;
      setAgents: typeof setAgents;
      settingsOpened: typeof settingsOpened;
    };
  }
}

window.computerFixture = { setHarnesses, setAgents, settingsOpened };
