import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCallsConfig } from './config.ts';
import { type World, wanted } from './watch.ts';

test('joins ringing, DM, allowed channels and invited meetings; exclusions override every path', () => {
  const config = parseCallsConfig({
    channels: ['allowed'],
    blockedChannels: ['blocked'],
    hungUp: ['hung-up'],
    voice: 'aura-2-arcas-en',
  });
  const world: World = {
    me: 'agent',
    config,
    calls: [],
    meetings: [
      {
        id: 'meeting',
        callId: 'meeting-call',
        createdBy: 'caller',
        title: 'Standup',
        shareToken: 'invite',
      },
      {
        id: 'customer-meeting',
        callId: 'customer-call',
        createdBy: 'caller',
        title: 'Macro x Acme',
        shareToken: 'customer-invite',
      },
    ],
  };
  world.calls = [
    {
      callId: 'ring',
      channelId: 'team',
      createdBy: 'caller',
      ringing: true,
      dm: false,
      name: 'team',
    },
    {
      callId: 'dm',
      channelId: 'dm',
      createdBy: 'caller',
      ringing: false,
      dm: true,
      name: '',
    },
    {
      callId: 'allowed',
      channelId: 'allowed',
      createdBy: 'caller',
      ringing: false,
      dm: false,
      name: 'team',
    },
    {
      callId: 'customer',
      channelId: 'allowed',
      createdBy: 'caller',
      ringing: true,
      dm: false,
      name: 'Macro Support x Acme',
    },
    {
      callId: 'hung-up',
      channelId: 'allowed',
      createdBy: 'caller',
      ringing: true,
      dm: true,
      name: '',
    },
    {
      callId: 'blocked',
      channelId: 'blocked',
      createdBy: 'caller',
      ringing: true,
      dm: true,
      name: '',
    },
    {
      callId: 'own',
      channelId: 'allowed',
      createdBy: 'agent',
      ringing: true,
      dm: true,
      name: '',
    },
    {
      callId: 'uninvited',
      channelId: 'other',
      createdBy: 'caller',
      ringing: false,
      dm: false,
      name: '',
    },
  ];
  assert.deepStrictEqual(
    wanted(world).map((call) => call.callId),
    ['ring', 'dm', 'allowed', 'meeting-call']
  );
});
