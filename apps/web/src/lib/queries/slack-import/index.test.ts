import { QueryClient } from '@tanstack/solid-query';
import { describe, expect, it } from 'vitest';
import { invalidateSlackImport, parseSlackImportUpdate } from './index';
import { slackImportKeys } from './keys';

const teamId = '01900000-0000-7000-8000-000000000001';
const jobId = '01900000-0000-7000-8000-000000000002';
const otherTeam = '01900000-0000-7000-8000-000000000003';
const otherJob = '01900000-0000-7000-8000-000000000004';
const event = { teamId, jobId, revision: 1, status: 'processing' };

describe('Slack import cache identity and invalidation', () => {
  it('keys jobs and every receipt page by team', () => {
    expect(slackImportKeys.job(teamId, jobId).queryKey).not.toEqual(
      slackImportKeys.job(otherTeam, jobId).queryKey
    );
    expect(slackImportKeys.list(teamId).queryKey).not.toEqual(
      slackImportKeys.list(otherTeam).queryKey
    );
  });

  it('invalidates only the matching job and that team’s list pages', async () => {
    const cache = new QueryClient();
    const matching = [
      slackImportKeys.list(teamId).queryKey,
      slackImportKeys.list(teamId, jobId).queryKey,
      slackImportKeys.job(teamId, jobId).queryKey,
    ];
    const unrelated = [
      slackImportKeys.list(otherTeam).queryKey,
      slackImportKeys.job(otherTeam, jobId).queryKey,
      slackImportKeys.job(teamId, otherJob).queryKey,
      ['channel', 'listChannels'],
    ];
    for (const key of [...matching, ...unrelated]) cache.setQueryData(key, {});
    await invalidateSlackImport(cache, { teamId, jobId });
    for (const key of matching)
      expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of unrelated)
      expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
    cache.clear();
  });
});

describe('slack_import_updated payloads', () => {
  it('accepts object and JSON-string envelopes without trusting extra fields', () => {
    expect(parseSlackImportUpdate(event)).toEqual(event);
    expect(parseSlackImportUpdate(JSON.stringify(event))).toEqual(event);
    expect(
      parseSlackImportUpdate({ ...event, key: 'not-a-cache-key' })
    ).toEqual(event);
  });

  it.each([
    undefined,
    null,
    [],
    1,
    'not json',
    '{}',
    JSON.stringify(JSON.stringify(event)),
    { ...event, teamId: '' },
    { ...event, jobId: '../job' },
    { ...event, revision: -1 },
    { ...event, revision: 0.5 },
    { ...event, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...event, revision: '1' },
    { ...event, revision: undefined },
    { ...event, status: 'unknown' },
    { ...event, status: undefined },
  ])('ignores malformed payload %j', (payload) => {
    expect(parseSlackImportUpdate(payload)).toBeUndefined();
  });
});
