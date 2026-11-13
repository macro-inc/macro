import { describe, expect, it } from 'vitest';
import { ACME_DRAFT, ACME_FIELDS, AVERY, SARAH } from '../tests/packets';
import {
  blocksSending,
  boxAtPoint,
  clampBox,
  placementProblems,
} from './fields';

describe('boxAtPoint', () => {
  it('centers a field on the drop point', () => {
    const box = boxAtPoint('signature', { xPct: 0.5, yPct: 0.5 });
    expect(box.xPct + box.widthPct / 2).toBeCloseTo(0.5);
    expect(box.yPct + box.heightPct / 2).toBeCloseTo(0.5);
  });

  it('keeps a field dropped at the edge on the page', () => {
    const box = boxAtPoint('signature', { xPct: 0.99, yPct: 0.99 });
    expect(box.xPct + box.widthPct).toBeLessThanOrEqual(1);
    expect(box.yPct + box.heightPct).toBeLessThanOrEqual(1);
  });
});

describe('clampBox', () => {
  it('holds a resized field to a usable minimum', () => {
    const box = clampBox({ xPct: 0.2, yPct: 0.2, widthPct: 0, heightPct: -1 });
    expect(box.widthPct).toBeGreaterThan(0);
    expect(box.heightPct).toBeGreaterThan(0);
  });
});

describe('placementProblems', () => {
  const packet = {
    documents: ACME_DRAFT.documents,
    recipients: ACME_DRAFT.recipients,
  };

  it('finds nothing wrong when every signer signs every document', () => {
    expect(placementProblems({ ...packet, fields: ACME_FIELDS })).toEqual([]);
  });

  it('warns, without blocking, when a signer misses one document', () => {
    const fields = ACME_FIELDS.filter(
      (field) => field.id !== 'avery-order-signature'
    );
    const problems = placementProblems({ ...packet, fields });

    expect(problems).toEqual([
      {
        kind: 'no_signature_field',
        recipientId: AVERY,
        documentId: 'order-form',
      },
    ]);
    expect(problems.some(blocksSending)).toBe(false);
  });

  it('blocks sending when a signer has no signature field at all', () => {
    const fields = ACME_FIELDS.filter((field) => field.recipientId === SARAH);
    const problems = placementProblems({ ...packet, fields });

    expect(problems).toEqual([
      { kind: 'no_signature_field', recipientId: AVERY },
    ]);
    expect(problems.some(blocksSending)).toBe(true);
  });

  it('blocks a packet with only copy recipients', () => {
    const recipients = ACME_DRAFT.recipients.filter(
      (recipient) => recipient.role === 'copy'
    );
    expect(placementProblems({ ...packet, recipients, fields: [] })).toEqual([
      { kind: 'no_signers' },
    ]);
  });
});
