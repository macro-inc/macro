import { describe, expect, it } from 'vitest';
import type { Test } from './evidence';
import { imapEvidence, missingImapEvidence } from './imap';
import {
  IMAP_CONFIRMATION,
  IMAP_EVIDENCE,
  IMAP_JOURNEY,
  IMAP_OPERATIONS,
} from './manifest/imap';

const observations = {
  states: [IMAP_CONFIRMATION.connect, IMAP_CONFIRMATION.reconnect],
  operations: [...IMAP_OPERATIONS],
};
function journey(layout: 'desktop' | 'mobile', data = observations): Test {
  const attachment = {
    name: IMAP_EVIDENCE,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(data)).toString('base64'),
  };
  return {
    id: layout,
    title: `${layout} IMAP inbox › ${IMAP_JOURNEY}`,
    file: 'full-stack-imap.spec.ts',
    line: 1,
    knownBug: false,
    sometimes: false,
    status: 'expected',
    results: [
      { status: 'passed', retry: 0, duration: 100, attachments: [attachment] },
    ],
  };
}

describe('IMAP full-stack evidence', () => {
  it('requires both real layouts and every asserted state and service operation', () => {
    const desktop = journey('desktop');
    expect(
      missingImapEvidence(imapEvidence([desktop, journey('mobile')]))
    ).toEqual([]);
    const mobile = journey('mobile', {
      states: [IMAP_CONFIRMATION.connect],
      operations: IMAP_OPERATIONS.filter((id) => !id.startsWith('PATCH')),
    });
    expect(missingImapEvidence(imapEvidence([desktop, mobile]))).toEqual([
      'IMAP phone: missing visible "Inbox reconnected" confirmation',
      'IMAP phone: no successful browser request to PATCH /email/email/links/{}/imap/settings',
    ]);
  });
  it('never credits another test, a skipped layout, or evidence from a failed attempt', () => {
    const test = journey('desktop');
    const retry = {
      ...test,
      status: 'flaky' as const,
      results: [
        { ...test.results[0], status: 'failed' },
        { status: 'passed', retry: 1, duration: 1 },
      ],
    };
    expect(
      imapEvidence([
        { ...test, file: 'connect-more.spec.ts' },
        { ...journey('mobile'), status: 'skipped' },
        retry,
      ])
    ).toEqual([]);
    expect(missingImapEvidence([])).toHaveLength(14);
  });
});
