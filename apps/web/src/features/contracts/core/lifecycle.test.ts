import { describe, expect, it } from 'vitest';
import {
  ACME_DRAFT,
  ACME_FIELDS,
  AVERY,
  acmeDraft,
  SARAH,
  signAs,
  TYPED_SIGNATURE,
  testContext,
} from '../tests/packets';
import {
  createDraft,
  declinePacket,
  expireIfDue,
  MAX_MARK_LENGTH,
  markSignedOffline,
  mergePackets,
  nextReminderAt,
  recordView,
  remindIfDue,
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
const AVERY_SIGNS_AT = '2026-11-12T22:40:05.000Z';

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

describe('setFields', () => {
  it('refuses a field on a page the document does not have', () => {
    const context = testContext();
    const draft = createDraft(ACME_DRAFT, context)._unsafeUnwrap();
    const [signature] = ACME_FIELDS;

    const result = setFields(draft, [{ ...signature, page: 14 }], context);
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'fields_misplaced' });
  });

  it('refuses a field for a document or signer of another packet', () => {
    const context = testContext();
    const draft = createDraft(ACME_DRAFT, context)._unsafeUnwrap();
    const [signature] = ACME_FIELDS;

    for (const stray of [
      { ...signature, documentId: 'another-packet' },
      { ...signature, recipientId: 'another-signer' },
      // A copy recipient receives the result; they never fill a field.
      { ...signature, recipientId: 'dana' },
    ]) {
      expect(setFields(draft, [stray], context)._unsafeUnwrapErr()).toEqual({
        kind: 'fields_misplaced',
      });
    }
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

describe('signing', () => {
  const values = { 'sarah-title': 'VP, Operations' };

  it('fills the signer fields, then invites the next signer', () => {
    const { context, packet } = sent();
    const signed = signAs(
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
    const afterSarah = signAs(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values },
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();
    const done = signAs(
      afterSarah,
      token(afterSarah, AVERY),
      { ...TYPED_SIGNATURE, values: {} },
      context.at(AVERY_SIGNS_AT)
    )._unsafeUnwrap();

    expect(packetStatus(done, AVERY_SIGNS_AT)).toBe('signed');
    expect(done.completedAt).toBe(AVERY_SIGNS_AT);
    expect(eventTypes(done).slice(-2)).toEqual([
      'contract.signed_by_recipient',
      'contract.completed',
    ]);
  });

  it('rejects a signature that leaves a required field empty', () => {
    const { context, packet } = sent();
    const result = signAs(
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

  it('refuses a blank typed signature', () => {
    const { context, packet } = sent();
    const result = signAs(
      packet,
      token(packet, SARAH),
      {
        signature: { kind: 'typed', text: '   ', style: 'script-1' },
        initials: TYPED_SIGNATURE.initials,
        values: { 'sarah-title': 'VP, Operations' },
      },
      context.at(SARAH_SIGNS_AT)
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'signature_missing' });
  });

  it('refuses a drawn mark larger than a packet keeps', () => {
    const { context, packet } = sent();
    const result = signAs(
      packet,
      token(packet, SARAH),
      {
        signature: { kind: 'image', dataUrl: 'x'.repeat(MAX_MARK_LENGTH + 1) },
        initials: TYPED_SIGNATURE.initials,
        values: { 'sarah-title': 'VP, Operations' },
      },
      context.at(SARAH_SIGNS_AT)
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'signature_too_large' });
  });

  it('keeps only the kind of value a field takes', () => {
    const { context, packet } = sent();
    const signed = signAs(
      packet,
      token(packet, SARAH),
      {
        ...TYPED_SIGNATURE,
        values: {
          'sarah-title': 'VP, Operations',
          // A signature field renders the adopted mark, never typed text.
          'sarah-signature': 'forged text',
          // Another signer's field is not this signer's to fill.
          'avery-signature': 'not mine',
        },
      },
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();

    const value = (id: string) =>
      signed.fields.find((field) => field.id === id)?.value;
    expect(value('sarah-title')).toBe('VP, Operations');
    expect(value('sarah-signature')).toBeUndefined();
    expect(value('avery-signature')).toBeUndefined();
  });

  it('treats a tick sent to a text field as no answer', () => {
    const { context, packet } = sent();
    const result = signAs(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values: { 'sarah-title': true } },
      context.at(SARAH_SIGNS_AT)
    );
    expect(result.isErr()).toBe(true);
  });

  it('refuses a signature before the disclosure is accepted', () => {
    const { context, packet } = sent();
    const result = signPacket(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values },
      context.at(SARAH_SIGNS_AT)
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'disclosure_required' });
  });

  it('rejects a signer whose turn has not come', () => {
    const { context, packet } = sent();
    const result = signAs(
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
    const result = signAs(
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
    expect(overridden.completedAt).toBe(SARAH_SIGNS_AT);
    expect(findRecipient(overridden, SARAH)?.access).toBeUndefined();
    expect(eventTypes(overridden).at(-1)).toBe('audit.status_overridden');
  });
});

describe('markSignedOffline', () => {
  it('refuses a packet that was never sent', () => {
    const context = testContext();
    const draft = acmeDraft(context);
    expect(
      markSignedOffline(draft, 'Avery Lee', context)._unsafeUnwrapErr()
    ).toEqual({ kind: 'not_in_flight' });
  });
});

describe('replaceDocument', () => {
  it('voids earlier links and signatures and invites the first signer again', () => {
    const { context, packet } = sent();
    const afterSarah = signAs(
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

  it('refuses a revision that leaves a signer with nowhere to sign', () => {
    const context = testContext();
    const draft = createDraft(
      { ...ACME_DRAFT, documents: [ACME_DRAFT.documents[1]] },
      context
    )._unsafeUnwrap();
    const onlyMsa = setFields(
      draft,
      ACME_FIELDS.filter((field) => field.documentId === 'msa'),
      context
    )._unsafeUnwrap();
    const packet = sendPacket(onlyMsa, context.at(SENT_AT))._unsafeUnwrap();

    const result = replaceDocument(
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
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'signature_field_lost' });
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

    const afterSarah = signAs(
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

describe('remindIfDue', () => {
  it('reminds pending signers once the cadence has passed, as Macro', () => {
    const { context, packet } = sent();
    // Three days is the default cadence; nothing is due before it.
    const early = remindIfDue(packet, context.at('2026-11-11T21:05:40.000Z'));
    expect(early).toBe(packet);

    const reminded = remindIfDue(
      packet,
      context.at('2026-11-12T21:05:40.000Z')
    );
    const reminder = reminded.events.at(-1);
    expect(reminder).toMatchObject({
      type: 'audit.reminder_sent',
      actor: 'Macro',
      recipientId: SARAH,
    });
    // The next one counts from this reminder.
    expect(remindIfDue(reminded, context.at('2026-11-13T21:05:40.000Z'))).toBe(
      reminded
    );
  });

  it('leaves a packet alone when reminders are off or it is closed', () => {
    const { context, packet } = sent({ reminderDays: null });
    const later = context.at('2026-11-20T00:00:00.000Z');
    expect(remindIfDue(packet, later)).toBe(packet);

    const voided = voidPacket(
      sent().packet,
      'Superseded',
      later
    )._unsafeUnwrap();
    expect(remindIfDue(voided, later)).toBe(voided);
  });
});

describe('mergePackets', () => {
  const NDA: Parameters<typeof acmeDraft>[1] = {
    title: 'Acme NDA',
    databaseIds: ['ndas'],
    documents: [
      {
        id: 'nda',
        name: 'Mutual NDA',
        pageCount: 3,
        source: 'upload',
        sha256: 'd'.repeat(64),
      },
    ],
    recipients: [
      {
        id: 'sarah-again',
        name: 'Sarah Chen',
        email: 'Sarah.Chen@acme.example',
        role: 'signer',
        isSender: false,
      },
      {
        id: 'lee',
        name: 'Lee Okafor',
        email: 'lee.okafor@acme.example',
        role: 'signer',
        isSender: false,
      },
    ],
  };
  const NDA_FIELDS = [
    {
      id: 'nda-sarah',
      documentId: 'nda',
      page: 2,
      recipientId: 'sarah-again',
      kind: 'signature' as const,
      required: true,
      box: { xPct: 0.1, yPct: 0.7, widthPct: 0.3, heightPct: 0.05 },
    },
    {
      id: 'nda-lee',
      documentId: 'nda',
      page: 2,
      recipientId: 'lee',
      kind: 'signature' as const,
      required: true,
      box: { xPct: 0.55, yPct: 0.7, widthPct: 0.3, heightPct: 0.05 },
    },
  ];
  function ndaDraft(context: ReturnType<typeof testContext>) {
    const draft = createDraft(
      { ...ACME_DRAFT, ...NDA },
      context
    )._unsafeUnwrap();
    return setFields(draft, NDA_FIELDS, context)._unsafeUnwrap();
  }

  it('unifies documents, recipients, fields, and databases of two drafts', () => {
    const context = testContext();
    const target = acmeDraft(context);
    const source = ndaDraft(context);

    const merged = mergePackets(target, source, context)._unsafeUnwrap();

    expect(merged.id).toBe(target.id);
    expect(merged.documents.map((document) => document.id)).toEqual([
      'order-form',
      'msa',
      'nda',
    ]);
    // Sarah is in both packets under one email: she is one recipient. The
    // new signer signs before the sender, who still countersigns last.
    expect(merged.recipients.map((recipient) => recipient.id)).toEqual([
      SARAH,
      'lee',
      AVERY,
      'dana',
    ]);
    expect(
      merged.fields.find((field) => field.id === 'nda-sarah')?.recipientId
    ).toBe(SARAH);
    expect(merged.databaseIds).toEqual(['customer-agreements', 'ndas']);
    expect(packetStatus(merged, context.now)).toBe('draft');
  });

  it('keeps the merged packet’s history and records the merge', () => {
    const context = testContext();
    const source = ndaDraft(context);
    const merged = mergePackets(
      acmeDraft(context),
      source,
      context
    )._unsafeUnwrap();

    expect(merged.events.at(-1)).toMatchObject({
      type: 'audit.packets_merged',
      note: 'Acme NDA',
    });
    expect(merged.merged).toEqual([
      {
        id: source.id,
        title: 'Acme NDA',
        mergedAt: context.now,
        recipients: [
          { id: 'sarah-again', name: 'Sarah Chen' },
          { id: 'lee', name: 'Lee Okafor' },
        ],
        events: source.events,
      },
    ]);
  });

  it('keeps one copy of a document both packets hold', () => {
    const context = testContext();
    const target = acmeDraft(context);
    const twin = createDraft(
      {
        ...ACME_DRAFT,
        title: 'Acme MSA (copy)',
        documents: [{ ...ACME_DRAFT.documents[1], id: 'msa-uploaded-again' }],
      },
      context
    )._unsafeUnwrap();

    const merged = mergePackets(target, twin, context)._unsafeUnwrap();

    expect(merged.documents.map((document) => document.id)).toEqual([
      'order-form',
      'msa',
    ]);
  });

  it('starts signing over when the target was already out for signature', () => {
    const { context, packet } = sent();
    const afterSarah = signAs(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values: { 'sarah-title': 'VP, Operations' } },
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();
    const later = context.at('2026-11-11T09:00:00.000Z');

    const merged = mergePackets(
      afterSarah,
      ndaDraft(context),
      later
    )._unsafeUnwrap();

    // Sarah signed before the NDA was part of the packet: she signs again.
    const sarah = findRecipient(merged, SARAH);
    expect(sarah?.signedAt).toBeUndefined();
    expect(sarah?.access?.issuedAt).toBe(later.now);
    expect(sarah?.access?.token).not.toBe(token(packet, SARAH));
    expect(packetStatus(merged, later.now)).toBe('sent');
  });

  it('ends signing on a merged-in packet that was out for signature', () => {
    // One context for both packets, so each gets its own id.
    const { context, packet } = sent();
    const draft = ndaDraft(context);
    const partlySigned = signAs(
      packet,
      token(packet, SARAH),
      { ...TYPED_SIGNATURE, values: { 'sarah-title': 'VP, Operations' } },
      context.at(SARAH_SIGNS_AT)
    )._unsafeUnwrap();

    const merged = mergePackets(
      draft,
      partlySigned,
      context.at('2026-11-11T09:00:00.000Z')
    )._unsafeUnwrap();

    // The draft stays a draft: nobody has a link, and nothing is signed.
    expect(packetStatus(merged, '2026-11-11T09:00:00.000Z')).toBe('draft');
    expect(merged.recipients.every((each) => !each.access)).toBe(true);
    expect(merged.recipients.every((each) => !each.signedAt)).toBe(true);
    expect(merged.fields.every((field) => field.value === undefined)).toBe(
      true
    );
    // What the merged-in packet had been through is still on record.
    expect(merged.merged?.[0].events.map((event) => event.type)).toContain(
      'contract.signed_by_recipient'
    );
  });

  it('refuses two different documents that share an id', () => {
    const context = testContext();
    const target = acmeDraft(context);
    const other = createDraft(
      {
        ...ACME_DRAFT,
        title: 'Another packet',
        documents: [
          { ...ACME_DRAFT.documents[0], pageCount: 9, sha256: 'e'.repeat(64) },
        ],
      },
      context
    )._unsafeUnwrap();

    expect(mergePackets(target, other, context)._unsafeUnwrapErr()).toEqual({
      kind: 'cannot_merge',
    });
  });

  it('refuses a packet that is closed, and a packet with itself', () => {
    const { context, packet } = sent();
    const voided = voidPacket(packet, 'Superseded', context)._unsafeUnwrap();
    const draft = ndaDraft(context);

    expect(mergePackets(draft, voided, context)._unsafeUnwrapErr()).toEqual({
      kind: 'cannot_merge',
    });
    expect(mergePackets(voided, draft, context)._unsafeUnwrapErr()).toEqual({
      kind: 'cannot_merge',
    });
    expect(mergePackets(draft, draft, context)._unsafeUnwrapErr()).toEqual({
      kind: 'cannot_merge',
    });
  });

  it('refuses to merge into a sent packet a signer who has nowhere to sign', () => {
    const { context, packet } = sent();
    const unplaced = createDraft(
      { ...ACME_DRAFT, ...NDA },
      context
    )._unsafeUnwrap();

    expect(mergePackets(packet, unplaced, context)._unsafeUnwrapErr()).toEqual({
      kind: 'cannot_send',
    });
  });
});
