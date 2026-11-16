import { expect, test } from 'bun:test';
import { chatTarget } from '../capabilities/chat.ts';

test("postCallChat posts in the call given, else the one call it's in, and refuses to guess", () => {
  expect(chatTarget('given', [])).toBe('given');
  expect(chatTarget(undefined, [{ callId: 'a' }, { callId: 'a' }])).toBe('a');
  expect(() => chatTarget(undefined, [])).toThrow('not on a call');
  expect(() => chatTarget(undefined, [{ callId: null }])).toThrow(
    'pass callId (callsNow lists it)'
  );
  expect(() =>
    chatTarget(undefined, [{ callId: 'a' }, { callId: 'b' }])
  ).toThrow('on 2 calls');
});
