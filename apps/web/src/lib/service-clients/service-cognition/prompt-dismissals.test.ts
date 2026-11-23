import { fetchWithToken } from '@core/util/fetchWithToken';
import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';
import { promptDismissalsClient } from './prompt-dismissals';

vi.mock('@core/util/fetchWithToken', () => ({
  fetchWithToken: vi.fn(async () => ok({})),
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'cognition-service': 'https://cognition.test' },
}));

it('sends a dismissal that outlives the page, since it may go as the page closes', async () => {
  await promptDismissalsClient.dismiss('routine-suggestions:email');
  expect(fetchWithToken).toHaveBeenCalledWith(
    'https://cognition.test/onboarding/prompts/routine-suggestions%3Aemail/dismiss',
    { method: 'POST', keepalive: true }
  );
});
