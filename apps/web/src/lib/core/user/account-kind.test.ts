import { afterEach, expect, it, vi } from 'vitest';
import {
  isAgentAccount,
  isHumanAccount,
  seedMockDisplayNames,
} from './displayName';
import { tryMacroId } from './macroId';

vi.mock('@service-auth/client', () => ({
  authServiceClient: { getUserNamesWithEmail: vi.fn() },
}));
afterEach(() => vi.useRealTimers());

it('does not treat unresolved or agent identity as a human account', () => {
  vi.useFakeTimers();
  const id = tryMacroId('macro|account-kind@example.com');
  expect(isHumanAccount(id)).toBe(false);
  seedMockDisplayNames([
    { id: 'macro|account-kind@example.com', isAgent: true },
  ]);
  expect(isAgentAccount(id)).toBe(true);
  expect(isHumanAccount(id)).toBe(false);
  seedMockDisplayNames([
    { id: 'macro|account-kind@example.com', isAgent: false },
  ]);
  expect(isAgentAccount(id)).toBe(false);
  expect(isHumanAccount(id)).toBe(true);
});
