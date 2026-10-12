import { beforeEach, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));

import { reportEmailBodyShown } from './body-telemetry';

const shown = {
  messageId: 'message',
  path: 'cache' as const,
  source: 'memory' as const,
  prepareMs: 0.04,
  mountMs: 12.345,
  totalMs: 12.4,
  htmlLength: 4096,
};

beforeEach(() => track.mockClear());

it('sends nothing for a viewer outside the rollout', () => {
  reportEmailBodyShown(shown, undefined);
  expect(track).not.toHaveBeenCalled();
});

it('sends rounded timings without the message id and marks repeat displays', () => {
  reportEmailBodyShown(shown, 'test');
  reportEmailBodyShown(shown, 'test');
  expect(track).toHaveBeenNthCalledWith(1, 'email_body_shown', {
    arm: 'test',
    path: 'cache',
    source: 'memory',
    repeat: false,
    prepare_ms: 0,
    mount_ms: 12.3,
    total_ms: 12.4,
    html_kb: 4,
  });
  expect(track).toHaveBeenNthCalledWith(
    2,
    'email_body_shown',
    expect.objectContaining({ repeat: true })
  );
});
