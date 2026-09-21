import { TOKENS } from '@core/hotkey/tokens';
import { describe, expect, it, vi } from 'vitest';
import { CREATABLE_BLOCKS } from './Launcher';

const flags = vi.hoisted(() => ({ agents: false }));

// Keep the actual shared create-menu entries, with all pilots enabled. Their
// action implementations are unrelated to shortcut selection.
vi.mock('@app/features/agents-view/primitives/open-composer', () => ({}));
vi.mock('@app/features/block-agent/context/pending-session', () => ({}));
vi.mock('@app/features/block-agent/ui/AgentInput', () => ({}));
vi.mock(
  '@app/features/block-spreadsheet/primitives/use-spreadsheet-access',
  () => ({})
);
vi.mock(
  '@app/features/block-spreadsheet/queries/create-spreadsheet',
  () => ({})
);
vi.mock('@app/features/block-spreadsheet/queries/spreadsheet-access', () => ({
  isSpreadsheetEnabledForCurrentUser: () => true,
}));
vi.mock('@app/features/reminders/reminder-composer', () => ({}));
vi.mock('@app/lib/analytics/posthog', () => ({}));
vi.mock('@block-automation/component', () => ({}));
vi.mock('@block-md/observability', () => ({}));
vi.mock('@channel/CreateChannelModal', () => ({}));
vi.mock('@components/app/split-layout/layout', () => ({}));
vi.mock('@core/component/AI/component/input/ChatInput', () => ({}));
vi.mock('@core/component/EntityIcon', () => ({
  getIconConfig: () => ({ icon: () => null }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableChatV3Agents: 'agents',
  enableDatabases: 'databases',
  enableReminders: 'reminders',
  enableSnippets: 'snippets',
  isFeatureEnabled: (flag: string) => flag !== 'agents' || flags.agents,
}));
vi.mock('@core/directive/focusInput', () => ({}));
vi.mock('@core/hotkey/hotkeys', () => ({}));
vi.mock('@core/hotkey/state', () => ({}));
vi.mock('@core/mobile/isMobile', () => ({}));
vi.mock('@core/util/create', () => ({}));
vi.mock('@macro-inc/lexical-core/markdown-golden', () => ({}));
vi.mock('@queries/storage/databases', () => ({}));
vi.mock('@queries/storage/projects', () => ({}));
vi.mock('@ui', () => ({}));
vi.mock('@ui/components/Hotkey', () => ({}));
vi.mock('./mobile/MobileCreateSheet', () => ({}));

describe('create-menu keyboard shortcuts', () => {
  it.each([false, true])(
    'keeps database and spreadsheet reachable with agent rollout %s',
    (agents) => {
      flags.agents = agents;
      const enabled = CREATABLE_BLOCKS.filter(
        (item) => item.enabled?.() ?? true
      );
      const bindings = new Map(enabled.map((item) => [item.hotkey, item]));

      // Registration overrides earlier entries with the same key. Both pilots
      // must survive, alongside every other available create action.
      expect(bindings.size).toBe(enabled.length);
      expect(bindings.get('b')).toMatchObject({
        blockName: 'database',
        hotkeyToken: TOKENS.create.database,
        altHotkeyToken: TOKENS.create.databaseNewSplit,
      });
      expect(bindings.get('w')).toMatchObject({
        blockName: 'spreadsheet',
        hotkeyToken: TOKENS.create.spreadsheet,
        altHotkeyToken: TOKENS.create.spreadsheetNewSplit,
      });
    }
  );
});
