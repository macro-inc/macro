import { expect, test } from 'bun:test';
import {
  scan_for_lone_surrogate_escapes,
  scan_magic_chip_status,
  scan_reply_target_parent_keys,
} from './scan';

test('R-5 distinguishes escaped literals, valid pairs and unpaired units in values and keys', () => {
  expect(
    scan_for_lone_surrogate_escapes(
      String.raw`{"text":"\ud800x\udc00","\udfff":0}`
    )
  ).toBe(3);
  expect(
    scan_for_lone_surrogate_escapes(
      String.raw`{"text":"\ud83d\ude00","literal":"\\ud800"}`
    )
  ).toBe(0);
  expect(
    scan_for_lone_surrogate_escapes(String.raw`["\ud800\ud800\udc00\udfff"]`)
  ).toBe(2);
});

test('node scans aggregate unknown payloads without disclosing them', () => {
  const doc = {
    root: {
      type: 'root',
      children: [
        { type: 'magic-chip', status: 'acp_ready' },
        { type: 'magic-chip', status: 'sensitive-value' },
        { type: 'magic-chip' },
        { type: 'magic-chip', status: null },
        { type: 'magic-chip', status: ['acp_ready'] },
        { type: 'magic-chip', status: { status: 'acp_ready' } },
        { type: 'magic-chip', status: 0 },
        {
          type: 'reply-target',
          parent: { type: 'channel', id: 'opaque', 'sensitive-key': 'value' },
        },
        { type: 'reply-target', parent: null },
        { type: 'reply-target' },
      ],
    },
  };
  expect(scan_magic_chip_status(doc)).toEqual({
    nodes: 7,
    missing: 1,
    null: 1,
    known: 1,
    other: 4,
  });
  expect(scan_reply_target_parent_keys(doc)).toEqual({
    nodes: 3,
    missing: 1,
    invalid: 1,
    type: 1,
    id: 1,
    extraKeys: 1,
    parentsWithExtraKeys: 1,
  });
});
