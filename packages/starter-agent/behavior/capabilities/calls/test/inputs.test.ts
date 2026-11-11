import { expect, test } from 'bun:test';
import { invoke } from '../../../../test/invoke.ts';
import { memoryCredentials } from '../../../context/credentials.ts';
import { noVoice } from '../config.ts';
import { callsModule } from '../index.ts';

/**
 * The rules on calls inputs a type can't state. Each is checked before the
 * context is touched, so a context with just enough to destructure shows the
 * rule fired and nothing else did.
 */
const refuses = async (
  name: string,
  context: unknown,
  raw: unknown,
  message: string
): Promise<void> => {
  const invoked = await invoke(callsModule, name, context, raw);
  expect(invoked.kind).toBe('failed');
  expect(invoked.kind === 'failed' ? invoked.error : '').toContain(message);
};

test('postCallChat refuses empty text and an empty callId', async () => {
  const context = { calls: {} };
  await refuses(
    'postCallChat',
    context,
    { text: '' },
    'text must not be empty'
  );
  await refuses(
    'postCallChat',
    context,
    { text: 'hi', callId: '' },
    'callId must not be empty'
  );
});

test('placeCall and noCall refuse an empty who', async () => {
  const context = { ledgers: {} };
  await refuses(
    'placeCall',
    context,
    { who: '', why: 'a reason' },
    'who must not be empty'
  );
  await refuses('noCall', context, { who: '' }, 'who must not be empty');
});

test('hangUp refuses an empty call id', async () => {
  await refuses(
    'hangUp',
    {},
    { callIds: ['c1', ''] },
    'a call id must not be empty'
  );
});

test('callReport and replayCall refuse an empty call', async () => {
  await refuses('callReport', {}, { call: '' }, 'call must not be empty');
  await refuses(
    'replayCall',
    { voice: {} },
    { call: '' },
    'call must not be empty'
  );
});

test('joinCall refuses an empty id', async () => {
  await refuses(
    'joinCall',
    { voice: {} },
    { kind: 'channel', id: '' },
    'id must not be empty'
  );
});

test('callDecisions takes a whole count from 1 to 500', async () => {
  const context = { calls: { paths: {} } };
  for (const count of [0, 1.5, 501])
    await refuses(
      'callDecisions',
      context,
      { count },
      'count must be a whole number from 1 to 500'
    );
});

test('alwaysJoinCalls refuses an empty channelId', async () => {
  await refuses(
    'alwaysJoinCalls',
    { calls: { allowed: {} } },
    { channelId: '' },
    'channelId must not be empty'
  );
});

test('placeCall and askOntoCall refuse, naming the key, while calls have no speech key', async () => {
  const context = { credentials: memoryCredentials(), ledgers: {} };
  await refuses(
    'placeCall',
    context,
    { who: 'macro|ada@example.com', why: 'a reason' },
    noVoice
  );
  await refuses(
    'askOntoCall',
    context,
    { message: { channelId: 'c1', id: 'm1' } },
    noVoice
  );
  expect(noVoice).toContain('DEEPGRAM_API_KEY');
});
