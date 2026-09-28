// SES sending reputation.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// https://us5.datadoghq.com/monitors/1333601
adopted('ses-bounce-rate', {
  name: '[SES] Bounce Rate Increasing',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.ses.reputation_bounce_rate{aws_account:569036502058} > 0.05',
  message: `SES Bounce Rate Increasing.

{{#is_alert}} @slack-holy-shit-alarms {{/is_alert}} {{#is_alert_recovery}} @slack-holy-shit-alarms {{/is_alert_recovery}}

@slack-monitoring`,
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
adopted('ses-complaint-rate', {
  name: '[SES] Complaint Rate Increasing',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.ses.reputation_complaint_rate{aws_account:569036502058} > 0.005',
  message: `SES Bounce Rate Increasing. Action needs to be taken to prevent account suspension.

{{#is_warning}}@slack-monitoring{{/is_warning}}
{{#is_warning_recovery}}@slack-monitoring {{/is_warning_recovery}}

{{#is_alert}}@slack-holy-shit-alarms {{/is_alert}}
{{#is_alert_recovery}}@slack-holy-shit-alarms @slack-monitoring {{/is_alert_recovery}}

@hutch@macro.com`,
  monitorThresholds: {
    critical: '0.005',
    warning: '0.001',
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

{{#is_warning}}@slack-monitoring{{/is_warning}}
{{#is_warning_recovery}}@slack-monitoring {{/is_warning_recovery}}

{{#is_alert}}@slack-holy-shit-alarms {{/is_alert}}
{{#is_alert_recovery}}@slack-holy-shit-alarms @slack-monitoring {{/is_alert_recovery}}

@hutch@macro.com`,
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
