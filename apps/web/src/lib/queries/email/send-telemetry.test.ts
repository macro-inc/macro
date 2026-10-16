import { CombinedError } from '@urql/core';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EmailSendIntent } from './send-queue';
import { emailSendFailureKind, recordEmailSend } from './send-telemetry';

const telemetry = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({ Telemetry: telemetry }));
beforeEach(() => vi.resetAllMocks());

const intent: EmailSendIntent = {
  uuid: 'audit-attempt',
  phase: 'pending',
  locallyCancelled: false,
  cacheMissing: true,
  metadata: {
    kind: 'email-send-v1',
    payload: {
      input: {
        attempt: { attemptId: 'audit-attempt', linkId: 'audit-link' },
        message: { draftId: 'audit-draft', subject: 'PRIVATE SUBJECT' },
        attachmentIds: [],
        forwardedAttachmentIds: [],
        restoreBodyHtml: 'PRIVATE BODY',
      },
      draft: {
        draftId: 'audit-draft',
        threadDbId: 'audit-thread',
        senderLinkId: 'audit-link',
        senderEmail: 'PRIVATE ADDRESS',
        subject: 'PRIVATE SUBJECT',
        optimisticBodyHtml: 'PRIVATE BODY',
      },
    },
  },
};

it('exports only explicit lifecycle fields even when inputs contain private payloads', () => {
  const observation = {
    operation: 'recover' as const,
    outcome: 'error' as const,
    durationMs: 17,
    request: 'PRIVATE REQUEST',
    error: new Error('PRIVATE EXCEPTION'),
  };
  recordEmailSend(observation, intent);
  expect(telemetry.warn).toHaveBeenCalledWith('email_send.lifecycle', {
    'email_send.operation': 'recover',
    'email_send.outcome': 'error',
    'email_send.duration_ms': 17,
    'email_send.attempt_id': 'audit-attempt',
    'email_send.link_id': 'audit-link',
    'email_send.phase': 'pending',
    'email_send.cache_missing': true,
    'email_send.recovery_required': false,
    'email_send.cancellation_requested': false,
    'email_send.restoring': false,
  });
  expect(JSON.stringify(telemetry.warn.mock.calls)).not.toContain('PRIVATE');
});

it('isolates exporter failures from both successful and failed lifecycle operations', () => {
  telemetry.info.mockImplementation(() => {
    throw new Error('export unavailable');
  });
  telemetry.warn.mockImplementation(() => {
    throw new Error('export unavailable');
  });
  expect(() =>
    recordEmailSend({ operation: 'enqueue', outcome: 'queued' }, intent)
  ).not.toThrow();
  expect(() =>
    recordEmailSend({ operation: 'refresh', outcome: 'error' })
  ).not.toThrow();
});

it('classifies transport and GraphQL failures without exporting their private details', () => {
  for (const [error, expected] of [
    [
      new CombinedError({ networkError: new Error('PRIVATE response') }),
      'network',
    ],
    [
      new CombinedError({ graphQLErrors: [{ message: 'PRIVATE GraphQL' }] }),
      'graphql',
    ],
    [new Error('PRIVATE local failure'), 'unknown'],
  ] as const) {
    expect(emailSendFailureKind(error)).toBe(expected);
    recordEmailSend(
      {
        operation: 'recover',
        outcome: 'error',
        failureKind: emailSendFailureKind(error),
      },
      intent
    );
  }
  expect(JSON.stringify(telemetry.warn.mock.calls)).not.toContain('PRIVATE');
});
