import { expect, it } from 'vitest';
import { agentInitial } from './agent-initial';
import { getInitialsFromName } from './displayName';

it("draws an agent's avatar with one letter, even for a name of several words", () => {
  expect(agentInitial('ada')).toBe('A');
  expect(agentInitial('Ada Lovelace')).toBe('A');
  expect(agentInitial('  bo the builder ')).toBe('B');
});

it('keeps the first character whole, whatever script or emoji it is', () => {
  expect(agentInitial('émile')).toBe('É');
  // An e followed by a combining acute accent is one character.
  expect(agentInitial('émile')).toBe('É');
  expect(agentInitial('小明')).toBe('小');
  expect(agentInitial('𝓩ed')).toBe('𝓩');
  expect(agentInitial('👩‍💻 Dev')).toBe('👩‍💻');
  expect(agentInitial('🇫🇷 Agent')).toBe('🇫🇷');
});

it('skips invisible marks and punctuation before the first letter', () => {
  expect(agentInitial('\u200Fعلي')).toBe('ع');
  expect(agentInitial('\u200Eada')).toBe('A');
  expect(agentInitial('\u200Bbo')).toBe('B');
  expect(agentInitial('\uFEFFkim')).toBe('K');
  expect(agentInitial('"Nova"')).toBe('N');
  expect(agentInitial('שרה')).toBe('ש');
});

it('keeps a letter that would upper-case to two as written', () => {
  expect(agentInitial('ßeta')).toBe('ß');
});

it('shows a question mark while there is no name', () => {
  expect(agentInitial('')).toBe('?');
  expect(agentInitial('   ')).toBe('?');
  expect(agentInitial('\u200B...')).toBe('?');
});

it('leaves people with their two initials', () => {
  expect(getInitialsFromName('Ada Lovelace', 'ada@example.com')).toBe('AL');
  expect(getInitialsFromName('Ada', 'ada@example.com')).toBe('A');
});
