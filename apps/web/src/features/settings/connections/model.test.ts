import type { PipedreamConnectionResponse } from '@service-cognition/client';
import { describe, expect, it } from 'vitest';
import { capabilitiesFor, toConnectionsModel } from './model';

function connection(
  appSlug: string,
  enabled = true
): PipedreamConnectionResponse {
  return { app_slug: appSlug, server_name: 'Connected account', enabled };
}

describe('Pipedream connections model', () => {
  it.each(['slack', 'slack_v2'])(
    'presents %s as Slack and preserves its stored slug',
    (appSlug) => {
      const model = toConnectionsModel({
        pipedream: [connection(appSlug)],
        nativeMcp: [],
      });

      expect(capabilitiesFor(model, 'slack')).toEqual([
        expect.objectContaining({
          id: 'slack-ai',
          provider: 'slack',
          title: 'Slack',
          account: 'Connected account',
          status: 'connected',
          mechanism: 'pipedream',
          appSlug,
        }),
      ]);
      expect(model.providers).toEqual([
        expect.objectContaining({ id: 'slack', name: 'Slack', ready: 1 }),
      ]);
      expect(model.leftovers).toEqual([]);
    }
  );

  it('preserves disabled Slack connections', () => {
    const model = toConnectionsModel({
      pipedream: [connection('slack_v2', false)],
      nativeMcp: [],
    });
    expect(capabilitiesFor(model, 'slack')[0]).toMatchObject({
      status: 'off',
      appSlug: 'slack_v2',
    });
    expect(model.providers[0].ready).toBe(0);
  });

  describe.each([
    ['slack', 'slack_v2'],
    ['slack_v2', 'slack'],
  ])('alias input order: %s, %s', (first, second) => {
    it.each([
      [true, true],
      [false, true],
      [true, false],
      [false, false],
    ])(
      'prefers slack (enabled=%s) and keeps slack_v2 (enabled=%s) manageable',
      (slackEnabled, slackV2Enabled) => {
        const connections = [first, second].map((slug) => ({
          ...connection(slug, slug === 'slack' ? slackEnabled : slackV2Enabled),
          server_name: `${slug} account`,
        }));
        const model = toConnectionsModel({
          pipedream: connections,
          nativeMcp: [],
        });
        expect(capabilitiesFor(model, 'slack')).toEqual([
          expect.objectContaining({
            appSlug: 'slack',
            account: 'slack account',
            status: slackEnabled ? 'connected' : 'off',
          }),
        ]);
        expect(model.providers[0].ready).toBe(slackEnabled ? 1 : 0);
        expect(model.leftovers).toEqual([
          {
            kind: 'pipedream',
            id: 'pipedream:slack_v2',
            title: 'slack_v2 account',
            subtitle: 'slack_v2',
            appSlug: 'slack_v2',
            enabled: slackV2Enabled,
          },
        ]);
      }
    );
  });

  it('preserves other curated and non-curated Pipedream apps', () => {
    const model = toConnectionsModel({
      pipedream: [connection('github'), connection('posthog', false)],
      nativeMcp: [],
    });
    expect(capabilitiesFor(model, 'github')[0]).toMatchObject({
      provider: 'github',
      appSlug: 'github',
      status: 'connected',
    });
    expect(model.leftovers).toEqual([
      {
        kind: 'pipedream',
        id: 'pipedream:posthog',
        title: 'Connected account',
        subtitle: 'posthog',
        appSlug: 'posthog',
        enabled: false,
      },
    ]);
  });
});
