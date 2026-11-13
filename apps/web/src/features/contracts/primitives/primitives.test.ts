import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { sendPacket } from '../core/lifecycle';
import { findRecipient, type Packet } from '../core/packet';
import {
  ACME_DRAFT,
  acmeDraft,
  SARAH,
  TYPED_SIGNATURE,
  testContext,
} from '../tests/packets';
import { createPacketDraft } from './packet-draft';
import { createPlacement } from './placement';
import { createSigningProgress } from './signing-session';

const VIEWER = {
  id: 'owner',
  name: 'Avery Lee',
  email: 'avery.lee@macro.example',
};

function newDraft() {
  let ids = 0;
  return createPacketDraft({
    databaseId: 'customer-agreements',
    newId: () => `r-${++ids}`,
  });
}

describe('createPacketDraft', () => {
  it('names an untitled packet after its first document', () => {
    const draft = newDraft();
    draft.addDocument(ACME_DRAFT.documents[0]);
    draft.addDocument(ACME_DRAFT.documents[1]);
    expect(draft.state.title).toBe('Order Form');
  });

  it('reports what is missing, one thing at a time', () => {
    const draft = newDraft();
    expect(draft.problem()).toBe('title');

    draft.setTitle('Acme MSA');
    expect(draft.problem()).toBe('documents');

    draft.addDocument(ACME_DRAFT.documents[0]);
    expect(draft.problem()).toBeUndefined();

    draft.updateRecipient('r-1', { name: 'Sarah Chen', email: 'not-an-email' });
    expect(draft.problem()).toBe('recipient_details');

    draft.updateRecipient('r-1', { email: 'sarah.chen@acme.example' });
    draft.toggleDatabase('customer-agreements');
    expect(draft.problem()).toBe('database');
  });

  it('needs a signer when the sender does not sign', () => {
    const draft = newDraft();
    draft.setTitle('Acme MSA');
    draft.addDocument(ACME_DRAFT.documents[0]);
    draft.setIncludeSelf(false);
    expect(draft.problem()).toBe('signers');
  });

  it('puts the sender after the other signers and copies last', () => {
    const draft = newDraft();
    draft.setTitle(' Acme MSA ');
    draft.addDocument(ACME_DRAFT.documents[0]);
    draft.updateRecipient('r-1', {
      name: 'Dana Whitfield',
      email: 'dana@acme.example',
      role: 'copy',
    });
    draft.addRecipient();
    draft.updateRecipient('r-2', {
      name: 'Sarah Chen',
      email: 'sarah.chen@acme.example',
    });

    const input = draft.toInput(VIEWER);
    expect(input.title).toBe('Acme MSA');
    expect(
      input.recipients.map((recipient) => [
        recipient.name,
        recipient.role,
        recipient.isSender,
      ])
    ).toEqual([
      ['Sarah Chen', 'signer', false],
      ['Avery Lee', 'signer', true],
      ['Dana Whitfield', 'copy', false],
    ]);
  });

  it('leaves out a recipient row nobody filled in', () => {
    const draft = newDraft();
    draft.setTitle('Acme MSA');
    draft.addDocument(ACME_DRAFT.documents[0]);
    expect(
      draft.toInput(VIEWER).recipients.map((recipient) => recipient.name)
    ).toEqual(['Avery Lee']);
  });
});

describe('createPlacement', () => {
  const packet = {
    documents: ACME_DRAFT.documents,
    recipients: ACME_DRAFT.recipients,
    fields: [],
  };
  function newPlacement() {
    let ids = 0;
    return createPlacement({ packet, newId: () => `f-${++ids}` });
  }

  it('places a new field for the chosen signer and selects it', () => {
    const placement = newPlacement();
    placement.chooseRecipient('avery');
    placement.add('signature', 'msa', 13, { xPct: 0.5, yPct: 0.5 });

    expect(placement.fields()).toHaveLength(1);
    expect(placement.selected()).toMatchObject({
      id: 'f-1',
      recipientId: 'avery',
      documentId: 'msa',
      page: 13,
      required: true,
    });
  });

  it('keeps a moved field on its page', () => {
    const placement = newPlacement();
    placement.add('signature', 'msa', 0, { xPct: 0.5, yPct: 0.5 });
    placement.move('f-1', {
      xPct: 2,
      yPct: -1,
      widthPct: 0.3,
      heightPct: 0.05,
    });

    expect(placement.fields()[0].box).toEqual({
      xPct: 0.7,
      yPct: 0,
      widthPct: 0.3,
      heightPct: 0.05,
    });
  });

  it('stops a resized field at the page edge without moving it', () => {
    const placement = newPlacement();
    placement.add('signature', 'msa', 0, { xPct: 0.5, yPct: 0.5 });
    const { xPct, yPct } = placement.fields()[0].box;
    placement.resize('f-1', { xPct, yPct, widthPct: 3, heightPct: 3 });

    const box = placement.fields()[0].box;
    expect(box.xPct).toBe(xPct);
    expect(box.yPct).toBe(yPct);
    expect(box.xPct + box.widthPct).toBeCloseTo(1);
    expect(box.yPct + box.heightPct).toBeCloseTo(1);
  });

  it('clears the selection when the selected field is removed', () => {
    const placement = newPlacement();
    placement.add('text', 'msa', 0, { xPct: 0.5, yPct: 0.5 });
    placement.remove('f-1');

    expect(placement.fields()).toEqual([]);
    expect(placement.selected()).toBeUndefined();
  });

  it('duplicates a field just below the original', () => {
    const placement = newPlacement();
    placement.add('text', 'msa', 0, { xPct: 0.5, yPct: 0.5 });
    placement.duplicate('f-1');

    const [original, copy] = placement.fields();
    expect(copy.id).toBe('f-2');
    expect(copy.box.yPct).toBeGreaterThan(original.box.yPct);
    expect(placement.selected()?.id).toBe('f-2');
  });

  it('reports who still needs a signature field as fields change', () => {
    const placement = newPlacement();
    expect(placement.problems().map((problem) => problem.kind)).toEqual([
      'no_signature_field',
      'no_signature_field',
    ]);

    for (const document of ACME_DRAFT.documents) {
      placement.add('signature', document.id, 0, { xPct: 0.3, yPct: 0.5 });
    }
    placement.chooseRecipient('avery');
    for (const document of ACME_DRAFT.documents) {
      placement.add('signature', document.id, 0, { xPct: 0.7, yPct: 0.5 });
    }
    expect(placement.problems()).toEqual([]);
  });
});

describe('createSigningProgress', () => {
  function sentToSarah() {
    const context = testContext();
    const packet = sendPacket(acmeDraft(context), context)._unsafeUnwrap();
    const recipient = findRecipient(packet, SARAH);
    if (!recipient) throw new Error('Sarah is missing');
    return { packet, recipient };
  }
  const progressFor = (
    packet: Packet,
    recipient: NonNullable<ReturnType<typeof findRecipient>>
  ) =>
    createRoot(() =>
      createSigningProgress(
        () => packet,
        () => recipient
      )
    );

  it('counts only the fields the signer acts on', () => {
    const { packet, recipient } = sentToSarah();
    const progress = progressFor(packet, recipient);

    // Two signatures and a title; the date is filled for them.
    expect(progress.totalCount()).toBe(3);
    expect(progress.doneCount()).toBe(0);
    expect(progress.canFinish()).toBe(false);
  });

  it('walks the required fields in document order', () => {
    const { packet, recipient } = sentToSarah();
    const progress = progressFor(packet, recipient);
    expect(progress.next()?.id).toBe('sarah-order-signature');

    progress.adopt(TYPED_SIGNATURE);
    expect(progress.next()?.id).toBe('sarah-title');

    progress.setValue('sarah-title', 'VP, Operations');
    expect(progress.next()).toBeUndefined();
    expect(progress.canFinish()).toBe(true);
    expect(progress.input()).toEqual({
      ...TYPED_SIGNATURE,
      values: { 'sarah-title': 'VP, Operations' },
    });
  });

  it('does not accept blank text for a required field', () => {
    const { packet, recipient } = sentToSarah();
    const progress = progressFor(packet, recipient);
    progress.adopt(TYPED_SIGNATURE);
    progress.setValue('sarah-title', '   ');
    expect(progress.canFinish()).toBe(false);
  });
});
