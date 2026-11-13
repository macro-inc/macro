import { describe, expect, it } from 'vitest';
import {
  AVERY,
  acmeDraft,
  SARAH,
  signAs,
  TYPED_SIGNATURE,
  testContext,
} from '../tests/packets';
import { sendPacket } from './lifecycle';
import { findRecipient } from './packet';
import { printedFields } from './printed-fields';

const day = (iso: string) => iso.slice(0, 10);

function signedBySarah() {
  const context = testContext();
  const sent = sendPacket(
    acmeDraft(context),
    context.at('2026-11-09T21:05:40.000Z')
  )._unsafeUnwrap();
  return signAs(
    sent,
    findRecipient(sent, SARAH)?.access?.token ?? '',
    { ...TYPED_SIGNATURE, values: { 'sarah-title': 'VP, Operations' } },
    context.at('2026-11-10T19:26:47.000Z')
  )._unsafeUnwrap();
}

describe('printedFields', () => {
  it('prints a signer’s mark, text, and signing date on their page', () => {
    const prints = printedFields(signedBySarah(), 'msa', 13, day);

    expect(prints.map((field) => [field.id, field.print])).toEqual([
      ['sarah-signature', { t: 'mark', mark: TYPED_SIGNATURE.signature }],
      ['sarah-title', { t: 'text', text: 'VP, Operations' }],
      ['sarah-date', { t: 'text', text: '2026-11-10' }],
    ]);
  });

  it('prints nothing for a signer who has not signed', () => {
    const packet = signedBySarah();
    const avery = printedFields(packet, 'msa', 13, day).filter((field) =>
      field.id.startsWith(AVERY)
    );
    expect(avery).toEqual([]);
  });

  it('prints only the fields of the page asked for', () => {
    const packet = signedBySarah();
    expect(printedFields(packet, 'msa', 0, day)).toEqual([]);
    expect(
      printedFields(packet, 'order-form', 1, day).map((field) => field.id)
    ).toEqual(['sarah-order-signature']);
  });
});
