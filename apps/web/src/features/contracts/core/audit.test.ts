import { describe, expect, it } from 'vitest';
import {
  ACME_DRAFT,
  acmeDraft,
  SARAH,
  sha256,
  signAs,
  TYPED_SIGNATURE,
  testContext,
} from '../tests/packets';
import { firstBrokenEvent, sealEvents } from './audit';
import { buildCertificate } from './certificate';
import {
  createDraft,
  mergePackets,
  replaceDocument,
  sendPacket,
} from './lifecycle';
import { findRecipient } from './packet';

async function signedBySarah() {
  const context = testContext();
  const draft = await sealEvents(acmeDraft(context), sha256);
  const sent = await sealEvents(
    sendPacket(draft, context.at('2026-11-09T21:05:40.000Z'))._unsafeUnwrap(),
    sha256
  );
  const token = findRecipient(sent, SARAH)?.access?.token ?? '';
  const signed = signAs(
    sent,
    token,
    { ...TYPED_SIGNATURE, values: { 'sarah-title': 'VP, Operations' } },
    context.at('2026-11-10T19:26:47.000Z')
  )._unsafeUnwrap();
  return { context, sent, signed: await sealEvents(signed, sha256) };
}

describe('sealEvents', () => {
  it('chains every event and leaves sealed ones untouched', async () => {
    const { sent, signed } = await signedBySarah();

    expect(signed.events.every((event) => event.hash?.length === 64)).toBe(
      true
    );
    expect(signed.events.slice(0, sent.events.length)).toEqual(sent.events);
    expect(await firstBrokenEvent(signed.events, sha256)).toBeUndefined();
  });

  it('gives the packet a new state digest once a signer has signed', async () => {
    const { sent, signed } = await signedBySarah();
    const sentHash = sent.events.at(-1)?.stateHash;
    const signedHash = signed.events.at(-1)?.stateHash;

    expect(sentHash).toHaveLength(64);
    expect(signedHash).not.toBe(sentHash);
  });

  it('detects an edited entry', async () => {
    const { signed } = await signedBySarah();
    const tampered = signed.events.map((event, index) =>
      index === 1 ? { ...event, at: '2026-11-01T00:00:00.000Z' } : event
    );
    expect(await firstBrokenEvent(tampered, sha256)).toBe(1);
  });

  it('detects a removed entry', async () => {
    const { signed } = await signedBySarah();
    const shortened = signed.events.filter((_, index) => index !== 1);
    expect(await firstBrokenEvent(shortened, sha256)).toBe(1);
  });
});

describe('buildCertificate', () => {
  it('lists the state before signing and after each signature', async () => {
    const { signed } = await signedBySarah();
    const certificate = buildCertificate(signed);

    expect(certificate.hashes.map((hash) => hash.step)).toEqual([
      'before_signing',
      'after_signer',
    ]);
    expect(certificate.hashes[1]).toMatchObject({
      signerName: 'Sarah Chen',
      // One of two signers has signed, so no digest is final yet.
      final: false,
    });
    expect(certificate.signers[0]).toMatchObject({
      name: 'Sarah Chen',
      position: 1,
      signerCount: 2,
      tokenId: 'tok_1',
    });
    expect(certificate.copyRecipients).toEqual(['Dana Whitfield']);
  });

  it('drops the digests of signatures a merge voided', async () => {
    const signedPacket = await signedBySarah();
    const { signed } = signedPacket;
    const context = signedPacket.context.at('2026-11-11T09:00:00.000Z');
    const extra = createDraft(
      {
        ...ACME_DRAFT,
        title: 'Side letter',
        recipients: [],
        documents: [
          {
            id: 'side-letter',
            name: 'Side Letter',
            pageCount: 1,
            source: 'upload',
            sha256: 'd'.repeat(64),
          },
        ],
      },
      context
    )._unsafeUnwrap();
    const merged = await sealEvents(
      mergePackets(signed, extra, context)._unsafeUnwrap(),
      sha256
    );

    // Sarah signed before the side letter was part of the packet. Only the
    // packet as sent again, with it, is listed.
    const { hashes, signers } = buildCertificate(merged);
    expect(hashes.map((hash) => hash.step)).toEqual(['before_signing']);
    expect(hashes[0].hash).toBe(merged.events.at(-1)?.stateHash);
    expect(signers[0].signedAt).toBeUndefined();
  });

  it('drops the digests of signatures a replaced document voided', async () => {
    const { signed } = await signedBySarah();
    const context = testContext('2026-11-11T09:00:00.000Z');
    const revised = await sealEvents(
      replaceDocument(
        signed,
        'order-form',
        {
          id: 'order-form-v2',
          name: 'Order Form',
          pageCount: 2,
          source: 'upload',
          sha256: 'c'.repeat(64),
        },
        context
      )._unsafeUnwrap(),
      sha256
    );

    const { hashes } = buildCertificate(revised);
    // Only the state the signers are now asked to sign is listed.
    expect(hashes.map((hash) => hash.step)).toEqual(['before_signing']);
    expect(hashes[0].hash).toBe(revised.events.at(-1)?.stateHash);
  });
});
