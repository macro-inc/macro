import { CLAUDE_BOT_PRINCIPAL_ID } from '@core/constant/claudeAgent';
import { CODEX_BOT_PRINCIPAL_ID } from '@core/constant/codexAgent';
import {
  CURSOR_BOT_ID,
  CURSOR_BOT_PRINCIPAL_ID,
} from '@core/constant/cursorAgent';
import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import { MACRO_CODER_PRINCIPAL_ID } from '@core/constant/macroCoder';
import { MACRO_NEW_PRINCIPAL_ID } from '@core/constant/macroNew';
import MacroLogo from '@icon/macro-logo.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CodexIcon from '@icon/wide-codex-ide.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstPartyBotMark } from './firstPartyBotMark';
import { UserIcon } from './UserIcon';

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => undefined,
  getDisplayNameParts: () => ({ firstName: '', lastName: '' }),
  getInitials: () => '?',
  macroIdToEmail: (id: string) => id,
  tryMacroId: () => undefined,
  useIsConnectedSecondaryInbox: () => () => false,
}));
vi.mock('@core/signal/profilePicture', () => ({
  useProfilePictureUrl: () => [() => undefined],
}));

afterEach(cleanup);

describe('firstPartyBotMark', () => {
  it('gives both Macro bots and the coder the Macro logo', () => {
    for (const id of [
      MACRO_AGENT_PRINCIPAL_ID,
      MACRO_NEW_PRINCIPAL_ID,
      MACRO_CODER_PRINCIPAL_ID,
    ]) {
      expect(firstPartyBotMark(id)).toEqual({
        Icon: MacroLogo,
        tone: 'accent',
      });
    }
  });

  it('gives the partner agents their own marks', () => {
    expect(firstPartyBotMark(CURSOR_BOT_PRINCIPAL_ID)?.Icon).toBe(CursorIcon);
    expect(firstPartyBotMark(CURSOR_BOT_ID)?.Icon).toBe(CursorIcon);
    expect(firstPartyBotMark(CLAUDE_BOT_PRINCIPAL_ID)?.Icon).toBe(ClaudeIcon);
    expect(firstPartyBotMark(CODEX_BOT_PRINCIPAL_ID)?.Icon).toBe(CodexIcon);
  });

  it('has no mark for team bots or people', () => {
    expect(
      firstPartyBotMark('bot|11111111-2222-3333-4444-555555555555')
    ).toBeUndefined();
    expect(firstPartyBotMark('macro|peter@macro.com')).toBeUndefined();
    expect(firstPartyBotMark(undefined)).toBeUndefined();
  });
});

describe('UserIcon for first-party bots', () => {
  const svgOf = (container: HTMLElement) => container.querySelector('svg');

  it('draws the Cursor mark for the Cursor bot rather than a robot', () => {
    const { container: cursor } = render(() => (
      <UserIcon id={CURSOR_BOT_PRINCIPAL_ID} />
    ));
    const { container: reference } = render(() => <CursorIcon />);
    expect(svgOf(cursor)?.innerHTML).toBe(svgOf(reference)?.innerHTML);
  });

  it('draws the Macro logo for the agent-session Macro bot', () => {
    const { container: macro } = render(() => (
      <UserIcon id={MACRO_NEW_PRINCIPAL_ID} />
    ));
    const { container: reference } = render(() => <MacroLogo />);
    expect(svgOf(macro)?.innerHTML).toBe(svgOf(reference)?.innerHTML);
  });

  it('keeps the generic robot for a team bot without an avatar', () => {
    const { container: bot } = render(() => (
      <UserIcon id="bot|11111111-2222-3333-4444-555555555555" />
    ));
    const { container: reference } = render(() => <CursorIcon />);
    expect(svgOf(bot)).not.toBeNull();
    expect(svgOf(bot)?.innerHTML).not.toBe(svgOf(reference)?.innerHTML);
  });
});
