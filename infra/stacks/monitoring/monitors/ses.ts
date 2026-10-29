// SES sending reputation.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';
import { notify } from '../notify';

// https://us5.datadoghq.com/monitors/1333601
adopted('ses-bounce-rate', {
  name: '[SES] Bounce Rate Increasing',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.ses.reputation_bounce_rate{aws_account:569036502058} > 0.05',
  message: `SES Bounce Rate Increasing.

${notify({ pages: true })}`,
  monitorThresholds: {
    critical: '0.05',
    warning: '0.03',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/4178105
// No warning: SES has reported a flat 0.47% complaint rate since at least
// 2026-10-15 while recording no complaints, so a 0.1% warning never cleared.
adopted('ses-complaint-rate', {
  name: '[SES] Complaint Rate Increasing',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.ses.reputation_complaint_rate{aws_account:569036502058} > 0.005',
  message: `SES complaint rate is {{value}}. SES may pause sending at 0.5%.

${notify({ pages: true })}`,
  monitorThresholds: {
    critical: '0.005',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/4757927
adopted('ses-high-email-sends', {
  name: '[SES] HIGH EMAIL SENDS',
  type: 'query alert',
  query: 'sum(last_1h):avg:aws.ses.send.sum{*} by {aws_account} > 250',
  message: `SES is experiencing high email sends. This could be related to a potential attack and may require users to be blocked.

${notify({ pages: true })}`,
  monitorThresholds: {
    critical: '250',
    warning: '200',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});
