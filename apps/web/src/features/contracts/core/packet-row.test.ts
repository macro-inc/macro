import { describe, expect, it } from 'vitest';
import {
  acmeDraft,
  SARAH,
  TYPED_SIGNATURE,
  testContext,
} from '../tests/packets';
import { sendPacket, signPacket } from './lifecycle';
import { findRecipient } from './packet';
import {
  allRows,
  databaseRows,
  matchesFilter,
  toPacketRow,
} from './packet-row';

const SENT_AT = '2026-11-09T21:05:40.000Z';

function packets() {
  const context = testContext();
  const draft = { ...acmeDraft(context), id: 'draft', databaseIds: ['ndas'] };
  const sent = sendPacket(
    { ...acmeDraft(context.at('2026-11-09T21:03:00.000Z')), id: 'sent' },
    context.at(SENT_AT)
  )._unsafeUnwrap();
  const awaitingSender = signPacket(
    { ...sent, id: 'awaiting-sender' },
    findRecipient(sent, SARAH)?.access?.token ?? '',
    { ...TYPED_SIGNATURE, values: { 'sarah-title': 'VP, Operations' } },
    context.at('2026-11-10T19:26:47.000Z')
  )._unsafeUnwrap();
  return { draft, sent, awaitingSender };
}

describe('toPacketRow', () => {
  it('flags a packet that waits on the viewer only when it is their turn', () => {
    const { sent, awaitingSender } = packets();
    expect(toPacketRow(sent, SENT_AT).awaitsViewer).toBe(false);
    expect(
      toPacketRow(awaitingSender, '2026-11-11T00:00:00.000Z').awaitsViewer
    ).toBe(true);
  });
});

describe('matchesFilter', () => {
  it('sorts packets into the sidebar filters', () => {
    const { draft, sent, awaitingSender } = packets();
    const rows = allRows(
      [draft, sent, awaitingSender],
      '2026-11-11T00:00:00.000Z'
    );
    const ids = (filter: Parameters<typeof matchesFilter>[1]) =>
      rows
        .filter((row) => matchesFilter(row, filter))
        .map((row) => row.packet.id)
        .sort();

    expect(ids('all')).toEqual(['awaiting-sender', 'draft', 'sent']);
    expect(ids('in_flight')).toEqual(['awaiting-sender', 'sent']);
    expect(ids('needs_my_signature')).toEqual(['awaiting-sender']);
    expect(ids('completed')).toEqual([]);
  });
});

describe('databaseRows', () => {
  it('lists only the packets that live in the database', () => {
    const { draft, sent } = packets();
    expect(
      databaseRows([draft, sent], 'ndas', SENT_AT).map((row) => row.packet.id)
    ).toEqual(['draft']);
    expect(
      databaseRows([draft, sent], 'customer-agreements', SENT_AT).map(
        (row) => row.packet.id
      )
    ).toEqual(['sent']);
  });
});
