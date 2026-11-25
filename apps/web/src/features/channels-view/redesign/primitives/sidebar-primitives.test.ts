import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { SidebarChannel } from '../core/sidebar-model';
import {
  createJevTriageController,
  type JevDecideOutcome,
  type JevDecidePort,
} from './create-jev-triage';
import { createSidebarPreferences } from './create-sidebar-preferences';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    read: (userId: string) => store.get(userId) ?? null,
    write: (userId: string, value: string) => {
      store.set(userId, value);
    },
    dump: () => store,
  };
}

const NOW = Date.parse('2026-11-25T16:00:00Z');

function makeChannel(
  id: string,
  name: string,
  messageId: string
): SidebarChannel {
  return {
    id,
    name,
    channelType: 'team',
    teamId: 'team-1',
    isParticipant: true,
    updatedAtMs: NOW - 60_000,
    viewedAtMs: NOW - 120_000,
    createdAtMs: NOW - 86_400_000,
    frecencyScore: 1,
    participantIds: ['alice'],
    botParticipantIds: [],
    isAgentDm: false,
    latestMessage: {
      messageId,
      senderId: 'customer-1',
      content: 'Can you look into our SSO issue?',
      createdAtMs: NOW - 60_000,
      mentions: [],
    },
  };
}

describe('createSidebarPreferences', () => {
  it('persists preferences per account and isolates state on account switch', () => {
    const storage = createMemoryStorage();

    createRoot((dispose) => {
      const [userId, setUserId] = createSignal<string | undefined>('alice');
      const controller = createSidebarPreferences({ userId, storage });

      controller.setDmWindowLimit(12);
      controller.hideTeamSection('sec-sales');
      controller.setUnreadOnly(true);

      expect(controller.prefs.dmWindowLimit).toBe(12);
      expect(controller.prefs.hiddenTeamSectionIds).toEqual(['sec-sales']);
      expect(controller.prefs.unreadOnly).toBe(true);

      // Switching account restores that account's clean defaults without leaking Alice's state.
      setUserId('bob');
      expect(controller.prefs.dmWindowLimit).toBe(7);
      expect(controller.prefs.hiddenTeamSectionIds).toEqual([]);
      expect(controller.prefs.unreadOnly).toBe(false);

      // Switching back to Alice reloads her persisted preferences.
      setUserId('alice');
      expect(controller.prefs.dmWindowLimit).toBe(12);
      expect(controller.prefs.hiddenTeamSectionIds).toEqual(['sec-sales']);

      dispose();
    });
  });

  it('recovers cleanly from malformed stored JSON', () => {
    const storage = createMemoryStorage();
    storage.write('alice', '{corrupt json');

    createRoot((dispose) => {
      const controller = createSidebarPreferences({
        userId: () => 'alice',
        storage,
      });
      expect(controller.prefs.dmWindowLimit).toBe(7);
      expect(controller.prefs.activeLens).toBe('browse');
      dispose();
    });
  });
});

describe('createJevTriageController', () => {
  it('caches classifications by (channelId, messageId) so reloads make 0 network calls', async () => {
    const storage = createMemoryStorage();
    const decide = vi.fn<JevDecidePort>(async () => ({
      ok: true,
      probabilities: {
        needs_reply: 0.91,
        urgent: 0.82,
        resolved: 0.04,
        fyi_noise: 0.01,
      },
    }));

    const channels = [makeChannel('sup-1', 'Macro Support x Acme', 'm-1')];

    // First session: classifies via Jev and persists cache.
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const ctrl = createJevTriageController({
          accountKey: () => 'alice:1',
          userId: () => 'alice',
          enabled: () => true,
          channels: () => channels,
          supportChannelIds: () => new Set(['sup-1']),
          unreadOrMentionedIds: () => new Set(['sup-1']),
          mentionCounts: () => new Map(),
          teamMemberIds: () => new Set(['alice']),
          decide,
          storage,
          debounceMs: 0,
          now: () => NOW,
        });

        setTimeout(() => {
          expect(decide).toHaveBeenCalledTimes(1);
          expect(ctrl.engineStatus()).toBe('jev');
          expect(ctrl.triageByChannelId().get('sup-1')?.scores.urgent).toBe(
            0.82
          );
          dispose();
          resolve();
        }, 25);
      });
    });

    // Reload: same (channelId, messageId) hits localStorage cache with 0 calls.
    decide.mockClear();
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const ctrl = createJevTriageController({
          accountKey: () => 'alice:2',
          userId: () => 'alice',
          enabled: () => true,
          channels: () => channels,
          supportChannelIds: () => new Set(['sup-1']),
          unreadOrMentionedIds: () => new Set(['sup-1']),
          mentionCounts: () => new Map(),
          teamMemberIds: () => new Set(['alice']),
          decide,
          storage,
          debounceMs: 0,
          now: () => NOW,
        });

        setTimeout(() => {
          expect(decide).not.toHaveBeenCalled();
          expect(ctrl.triageByChannelId().get('sup-1')?.source).toBe('jev');
          expect(ctrl.engineStatus()).toBe('jev');
          dispose();
          resolve();
        }, 25);
      });
    });
  });

  it('degrades gracefully to heuristic mode when /decisions is unavailable and fences account switches', async () => {
    const storage = createMemoryStorage();
    const resolvers: Array<(outcome: JevDecideOutcome) => void> = [];
    const decide = vi.fn<JevDecidePort>(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );

    const channels = [makeChannel('sup-1', 'Macro Support x Acme', 'm-1')];

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [accountKey, setAccountKey] = createSignal<string | undefined>(
          'alice:1'
        );
        const [userId, setUserId] = createSignal<string | undefined>('alice');
        const ctrl = createJevTriageController({
          accountKey,
          userId,
          enabled: () => true,
          channels: () => channels,
          supportChannelIds: () => new Set(['sup-1']),
          unreadOrMentionedIds: () => new Set(['sup-1']),
          mentionCounts: () => new Map(),
          teamMemberIds: () => new Set(['alice']),
          decide,
          storage,
          debounceMs: 0,
          now: () => NOW,
        });

        // Wait a tick for Solid's initial createEffect to kick off Alice's request.
        setTimeout(() => {
          try {
            expect(resolvers.length).toBe(1);
            const resolveAlice = resolvers[0];

            // Switch account before Alice's in-flight request resolves.
            setUserId('bob');
            setAccountKey('bob:1');

            resolveAlice({
              ok: true,
              probabilities: {
                needs_reply: 0.99,
                urgent: 0.99,
                resolved: 0,
                fyi_noise: 0,
              },
            });

            setTimeout(() => {
              try {
                // Late Alice response must never land in Bob's triage map.
                expect(ctrl.triageByChannelId().get('sup-1')).toBeUndefined();
                dispose();
                resolve();
              } catch (err) {
                dispose();
                reject(err);
              }
            }, 25);
          } catch (err) {
            dispose();
            reject(err);
          }
        }, 10);
      });
    });

    // Separate run returning 503 unavailable -> falls back cleanly to heuristic.
    const unavailableDecide = vi.fn<JevDecidePort>(async () => ({
      ok: false,
      unavailable: true,
    }));

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const ctrl = createJevTriageController({
          accountKey: () => 'carol:1',
          userId: () => 'carol',
          enabled: () => true,
          channels: () => channels,
          supportChannelIds: () => new Set(['sup-1']),
          unreadOrMentionedIds: () => new Set(['sup-1']),
          mentionCounts: () => new Map(),
          teamMemberIds: () => new Set(['carol']),
          decide: unavailableDecide,
          storage,
          debounceMs: 0,
          now: () => NOW,
        });

        setTimeout(() => {
          try {
            expect(ctrl.engineStatus()).toBe('heuristic');
            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        }, 25);
      });
    });
  });
});
