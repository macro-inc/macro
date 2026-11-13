import { describe, expect, it } from 'vitest';
import {
  ACME_DRAFT,
  ACME_FIELDS,
  AVERY,
  acmeDraft,
  SARAH,
  TYPED_SIGNATURE,
  testContext,
} from '../tests/packets';
import {
  createDraft,
  declinePacket,
  expireIfDue,
  markSignedOffline,
  nextReminderAt,
  recordView,
  remindPending,
  replaceDocument,
  sendPacket,
  setFields,
  signPacket,
  voidPacket,
} from './lifecycle';
import { findRecipient, type Packet } from './packet';
import { packetStatus } from './status';

const SENT_AT = '2026-11-09T21:05:40.000Z';
const SARAH_SIGNS_AT = '2026-11-10T19:26:47.000Z';
const JACOB_SIGNS_AT = '2026-11-12T22:40:05.000Z';

function sent(overrides: Parameters<typeof acmeDraft>[1] = {}) {
  const context = testContext();
  const packet = sendPacket(
    acmeDraft(context, overrides),
    context.at(SENT_AT)
  )._unsafeUnwrap();
  return { context, packet };
}

function token(packet: Packet, recipientId: string): string {
  const access = findRecipient(packet, recipientId)?.access;
  if (!access) throw new Error(`${recipientId} has no signing link`);
  return access.token;
}

function eventTypes(packet: Packet): string[] {
  return packet.events.map((event) => event.type);
}

describe('createDraft', () => {
  it('refuses a packet that lives in no database', () => {
    const result = createDraft(
      { ...ACME_DRAFT, databaseIds: [] },
      testContext()
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'no_database' });
  });

  it('starts as a draft with the default window and cadence', () => {
    const context = testContext();
    const packet = createDraft(ACME_DRAFT, context)._unsafeUnwrap();
    expect(packetStatus(packet, context.now)).toBe('draft');
    expect(packet.expirationDays).toBe(30);
    expect(packet.reminderDays).toBe(3);
    expect(eventTypes(packet)).toEqual(['contract.created']);
  });
});

describe('sendPacket', () => {
  it('opens a 30-day window and invites only the first signer of a sequential packet', () => {
    const { packet } = sent();
    expect(packetStatus(packet, SENT_AT)).toBe('sent');
    expect(packet.expiresAt).toBe('2026-12-09T21:05:40.000Z');
    expect(findRecipient(packet, SARAH)?.access?.token).toBe('token-1');
    expect(findRecipient(packet, AVERY)?.access).toBeUndefined();
    expect(eventTypes(packet)).toEqual(['contract.created', 'contract.sent']);
  });

  it('invites every signer of a parallel packet at once', () => {
    const { packet } = sent({ signingOrder: 'parallel' });
    expect(findRecipient(packet, SARAH)?.access).toBeDefined();
    expect(findRecipient(packet, AVERY)?.access).toBeDefined();
  });

  it('refuses a packet whose signer has no signature field', () => {
    const context = testContext();
    const draft = createDraft(ACME_DRAFT, context)._unsafeUnwrap();
    const onlySarah = setFields(
      draft,
      ACME_FIELDS.filter((field) => field.recipientId === SARAH),
      context
    )._unsafeUnwrap();
    expect(sendPacket(onlySarah, context)._unsafeUnwrapErr()).toEqual({
      kind: 'cannot_send',
    });
  });

  it('refuses to send twice', () => {
    const { context, packet } = sent();
    expect(sendPacket(packet, context.at(SENT_AT))._unsafeUnwrapErr()).toEqual({
      kind: 'not_draft',
    });
  });
});

describe('signPacket', () => {
  const values = { 'sarah-title': 'VP, Operations' };

  it('fills the signer fields, then invites the next signer', () => {
    const { context, packet } = sent();
    const signed = signPacket(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values },
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();

    expect(packetStatus(signed, SARAH_SIGNS_AT)).toBe('partially_signed');
    expect(
      signed.fields.find((field) => field.id === 'sarah-date')?.value
    ).toBe(SARAH_SIGNS_AT);
    expect(findRecipient(signed, SARAH)?.access).toBeUndefined();
    expect(findRecipient(signed, AVERY)?.access?.issuedAt).toBe(SARAH_SIGNS_AT);
    expect(eventTypes(signed).slice(-2)).toEqual([
      'contract.signed_by_recipient',
      'contract.sent',
    ]);
  });

  it('completes the packet after the last signature', () => {
    const { context, packet } = sent();
    const afterSarah = signPacket(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values },
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();
    const done = signPacket(
      afterSarah,
      token(afterSarah, AVERY),
      { ...TYPED_SIGNATURE, values: {} },
      context.at(JACOB_SIGNS_AT)
    )._unsafeUnwrap();

    expect(packetStatus(done, JACOB_SIGNS_AT)).toBe('signed');
    expect(done.completedAt).toBe(JACOB_SIGNS_AT);
    expect(eventTypes(done).slice(-2)).toEqual([
      'contract.signed_by_recipient',
      'contract.completed',
    ]);
  });

  it('rejects a signature that leaves a required field empty', () => {
    const { context, packet } = sent();
    const result = signPacket(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values: {} },
      context.at(SARAH_SIGNS_AT)
    );
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'fields_incomplete',
      fieldIds: ['sarah-title'],
    });
  });

  it('rejects a signer whose turn has not come', () => {
    const { context, packet } = sent();
    const result = signPacket(
      packet,
      'token-for-avery',
      { ...TYPED_SIGNATURE, values: {} },
      context.at(SARAH_SIGNS_AT)
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'not_your_turn' });
  });

  it('rejects a link after the window closes', () => {
    const { context, packet } = sent();
    const late = context.at('2026-12-10T00:00:00.000Z');
    const result = signPacket(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values },
      late
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'not_in_flight' });
  });
});

describe('recordView', () => {
  it('records only the first view', () => {
    const { context, packet } = sent();
    const first = recordView(
      packet,
      token(packet, SARAH),
      'Safari',
      context.at('2026-11-10T19:21:03.000Z')
    )._unsafeUnwrap();
    const second = recordView(
      first,
      token(first, SARAH),
      'Chrome',
      context.at('2026-11-10T19:22:00.000Z')
    )._unsafeUnwrap();

    expect(findRecipient(second, SARAH)?.viewedAt).toBe(
      '2026-11-10T19:21:03.000Z'
    );
    expect(findRecipient(second, SARAH)?.userAgent).toBe('Safari');
    expect(
      eventTypes(second).filter((type) => type === 'contract.viewed')
    ).toHaveLength(1);
  });
});

describe('closing a packet', () => {
  it('declining deactivates every link', () => {
    const { context, packet } = sent({ signingOrder: 'parallel' });
    const declined = declinePacket(
      packet,
      token(packet, SARAH),
      'Wrong entity',
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();

    expect(packetStatus(declined, SARAH_SIGNS_AT)).toBe('declined');
    expect(declined.recipients.some((recipient) => recipient.access)).toBe(
      false
    );
  });

  it('voiding deactivates every link and keeps the reason', () => {
    const { context, packet } = sent();
    const voided = voidPacket(
      packet,
      'Superseded',
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();

    expect(packetStatus(voided, SARAH_SIGNS_AT)).toBe('voided');
    expect(voided.voidReason).toBe('Superseded');
    expect(findRecipient(voided, SARAH)?.access).toBeUndefined();
  });

  it('a draft cannot be voided', () => {
    const context = testContext();
    expect(
      voidPacket(acmeDraft(context), '', context)._unsafeUnwrapErr()
    ).toEqual({ kind: 'not_in_flight' });
  });

  it('expiry is recorded once, at the end of the window', () => {
    const { context, packet } = sent();
    const late = context.at('2026-12-20T00:00:00.000Z');
    const expired = expireIfDue(packet, late);

    expect(packetStatus(expired, late.now)).toBe('expired');
    expect(expired.expiredAt).toBe(packet.expiresAt);
    expect(findRecipient(expired, SARAH)?.access).toBeUndefined();
    expect(expireIfDue(expired, late)).toBe(expired);
  });

  it('a packet inside its window is left alone', () => {
    const { context, packet } = sent();
    expect(expireIfDue(packet, context.at(SARAH_SIGNS_AT))).toBe(packet);
  });

  it('marking signed offline closes the packet with an audit tag', () => {
    const { context, packet } = sent();
    const overridden = markSignedOffline(
      packet,
      'Avery Lee',
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();

    expect(packetStatus(overridden, SARAH_SIGNS_AT)).toBe('signed');
    expect(overridden.statusOverride?.tag).toBe('offline');
    expect(findRecipient(overridden, SARAH)?.access).toBeUndefined();
    expect(eventTypes(overridden).at(-1)).toBe('audit.status_overridden');
  });
});

describe('replaceDocument', () => {
  it('voids earlier links and signatures and invites the first signer again', () => {
    const { context, packet } = sent();
    const afterSarah = signPacket(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values: { 'sarah-title': 'VP, Operations' } },
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();

    const revisedAt = '2026-11-11T10:00:00.000Z';
    const revised = replaceDocument(
      afterSarah,
      'msa',
      {
        id: 'msa-v2',
        name: 'Master Services Agreement',
        pageCount: 14,
        source: 'upload',
        sha256: 'c'.repeat(64),
      },
      context.at(revisedAt)
    )._unsafeUnwrap();

    expect(packetStatus(revised, revisedAt)).toBe('sent');
    expect(findRecipient(revised, SARAH)?.signedAt).toBeUndefined();
    expect(findRecipient(revised, SARAH)?.access?.token).not.toBe('token-1');
    expect(findRecipient(revised, AVERY)?.access).toBeUndefined();
    expect(revised.fields.every((field) => field.value === undefined)).toBe(
      true
    );
    expect(eventTypes(revised).slice(-2)).toEqual([
      'audit.documents_replaced',
      'contract.sent',
    ]);
  });

  it('keeps the placed fields, dropping those on pages the revision lost', () => {
    const { context, packet } = sent();
    const revised = replaceDocument(
      packet,
      'msa',
      {
        id: 'msa-v2',
        name: 'Master Services Agreement',
        pageCount: 10,
        source: 'upload',
        sha256: 'c'.repeat(64),
      },
      context.at('2026-11-11T10:00:00.000Z')
    )._unsafeUnwrap();

    expect(revised.fields.map((field) => field.id)).toEqual([
      'sarah-order-signature',
      'avery-order-signature',
    ]);
  });
});

describe('reminders', () => {
  it('reminds only the signer whose turn it is', () => {
    const { context, packet } = sent();
    const reminded = remindPending(
      packet,
      context.at('2026-11-12T21:05:40.000Z')
    )._unsafeUnwrap();
    const reminders = reminded.events.filter(
      (event) => event.type === 'audit.reminder_sent'
    );
    expect(reminders.map((event) => event.recipientId)).toEqual([SARAH]);
  });

  it('counts the next reminder from the latest contact with a pending signer', () => {
    const { context, packet } = sent();
    expect(nextReminderAt(packet)).toBe('2026-11-12T21:05:40.000Z');

    const afterSarah = signPacket(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values: { 'sarah-title': 'VP, Operations' } },
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();
    expect(nextReminderAt(afterSarah)).toBe('2026-11-13T19:26:47.000Z');
  });

  it('has no next reminder when the cadence is off', () => {
    const { packet } = sent({ reminderDays: null });
    expect(nextReminderAt(packet)).toBeUndefined();
  });
});
