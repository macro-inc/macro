import { describe, expect, spyOn, test } from 'bun:test';
import { hydrateUserEvent, type UserEvent } from '../src/events/hydrate/user';
import type { MacroClient } from '../src/utils/client';

const client = {
  hosts: { 'static-files': 'https://static.example.com' },
} as unknown as MacroClient;

describe('hydrateUserEvent', () => {
  test('picture_changed carries the user and the static image', () => {
    const event = {
      event_type: 'user.picture_changed',
      metadata: {
        user_id: 'macro|owner@example.com',
        file_id: 'file-1',
        url: 'https://static.example.com/file/file-1',
      },
    } as UserEvent;

    const hydrated = hydrateUserEvent(client, event);

    expect(hydrated?.event_type).toBe('user.picture_changed');
    expect(hydrated?.user.id).toBe('macro|owner@example.com');
    expect(hydrated?.image?.id).toBe('file-1');
    expect(hydrated?.image?.url).toBe('https://static.example.com/file/file-1');
  });

  test('a removed or URL-set picture has no static image', () => {
    for (const file_id of [null, undefined]) {
      const event = {
        event_type: 'user.picture_changed',
        metadata: { user_id: 'macro|owner@example.com', file_id, url: null },
      } as UserEvent;

      expect(hydrateUserEvent(client, event)?.image).toBeUndefined();
    }
  });

  test('an event type from a newer server is skipped instead of throwing', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const fromNewerServer = JSON.parse(
      '{"event_type":"user.renamed","metadata":{}}',
    );

    expect(hydrateUserEvent(client, fromNewerServer)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
