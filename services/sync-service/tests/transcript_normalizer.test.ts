import { expect, test } from 'vitest';
import { normalize } from '../scripts/normalize-transcripts.mjs';

test('canonicalizes keys without changing byte strings or event order', () => {
  expect(normalize(['{"out":"send","frame_b64":"AAEC"}']))
    .toBe(normalize(['{"frame_b64":"AAEC","out":"send"}']));
  expect(normalize(['{"frame_b64":"AAEC"}']))
    .not.toBe(normalize(['{"frame_b64":"AQEC"}']));
  expect(normalize(['{"port":"put"}', '{"out":"send"}']))
    .not.toBe(normalize(['{"out":"send"}', '{"port":"put"}']));
});

test('retains clock read counts and kinds while replay keeps raw values', () => {
  const clock = '{"clock":"op_id_nanos","value":"123"}';
  expect(normalize([clock])).not.toBe(normalize([clock, clock]));
  expect(normalize([clock])).not.toBe(normalize([clock.replace('op_id_nanos', 'blame_ms')]));
  expect(normalize([clock])).toBe(normalize([clock.replace('123', '124')]));
});

test('compares alarm delays independently of the wall-clock epoch', () => {
  const record = (now: number, delay: number) => [
    JSON.stringify({ room: 'room', callback: 1, clock: 'alarm_set_ms', value: String(now) }),
    JSON.stringify({ room: 'room', callback: 1, port: 'storage.setAlarm', args: [{ date_ms: now + delay }, null] }),
  ];
  expect(normalize(record(1000, 5000))).toBe(normalize(record(2000, 5000)));
  expect(normalize(record(1000, 5000))).not.toBe(normalize(record(1000, 4000)));
});

test('preserves equal-instant versus later-instant decisions', () => {
  const record = (next: string) => [
    '{"room":"room","clock":"state_instant","value":"1"}',
    JSON.stringify({ room: 'room', clock: 'state_instant', value: next }),
  ];
  expect(normalize(record('1'))).not.toBe(normalize(record('2')));
});

test('keeps cross-callback socket delivery order while grouping callback effects', () => {
  const first = '{"room":"room","callback":1,"out":"send","ws_id":"socket","frame_b64":"AAEC"}';
  const second = '{"room":"room","callback":2,"out":"send","ws_id":"socket","frame_b64":"AQEC"}';
  expect(normalize([first, second])).not.toBe(normalize([second, first]));
});

test('keeps same-millisecond alarms in distinct rooms independent', () => {
  const record = (left: number, right: number) => [
    JSON.stringify({ room: 'a', clock: 'alarm_set_ms', value: String(left) }),
    JSON.stringify({ room: 'a', port: 'storage.setAlarm', args: [{ date_ms: left + 5000 }] }),
    JSON.stringify({ room: 'b', clock: 'alarm_set_ms', value: String(right) }),
    JSON.stringify({ room: 'b', port: 'storage.setAlarm', args: [{ date_ms: right + 5000 }] }),
  ];
  expect(normalize(record(1000, 1000))).toBe(normalize(record(2000, 2001)));
});

test('does not hide a stored expiry that differs from the input grant', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1000 })).toString('base64url');
  const input = JSON.stringify({ in: 'fetch', query: `?token=eyJhbGciOiJIUzI1NiJ9.${payload}.signature` });
  expect(normalize([input, '{"expires_at":1000}']))
    .not.toBe(normalize([input, '{"expires_at":1001}']));
});

test('does not substitute another socket grant expiry', () => {
  const connect = (room: string, expiry: number) => JSON.stringify({ room, in: 'fetch', query: `?token=eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: expiry })).toString('base64url')}.signature` });
  const record = (expiry: number) => [
    connect('a', 1000), '{"room":"a","out":"accept","ws_id":"socket-a"}',
    connect('b', 2000), '{"room":"b","out":"accept","ws_id":"socket-b"}',
    JSON.stringify({ room: 'a', port: 'storage.put', args: ['socket-a', { expires_at: expiry }] }),
  ];
  expect(normalize(record(1000))).not.toBe(normalize(record(2000)));
});


test('excludes only the newly observable presence clock reads', () => {
  const ordinary = '{"clock":"blame_ms","value":"123"}';
  const presence = '{"clock":"presence","value":"124"}';
  expect(normalize([ordinary, presence])).toBe(normalize([ordinary]));
  expect(normalize([ordinary, presence, ordinary])).not.toBe(normalize([ordinary]));
});
