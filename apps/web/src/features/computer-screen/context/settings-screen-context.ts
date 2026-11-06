import { createContext, useContext } from 'solid-js';

export type SettingsComputerScreen = {
  openHarness(harnessId: string, control?: boolean): void;
  openAgentComputer(agentUserId: string): void;
};

export const SettingsComputerScreenContext =
  createContext<SettingsComputerScreen>();
export function useSettingsComputerScreen() {
  return useContext(SettingsComputerScreenContext);
}
