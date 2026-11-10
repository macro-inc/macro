// Application load balancers.
//
// The `adopted()` monitors were created by hand in the Datadog UI. Do not edit
// a monitor here and in the UI at the same time — this file wins on deploy.
import * as datadog from '@pulumi/datadog';
import * as pulumi from '@pulumi/pulumi';
import { adopted } from '../adopted';
import { goalertWebhooks } from '../goalert';
import { notify, RENOTIFY_MINUTES } from '../notify';

// https://us5.datadoghq.com/monitors/1062605
adopted('alb-non-200-responses', {
  name: '[PROD] Load Balancer Non-200 Responses',
  type: 'query alert',
  query:
    'sum(last_1h):(sum:aws.applicationelb.httpcode_elb_5xx{level:prod OR environment:prod*} by {loadbalancer}.as_count() / sum:aws.applicationelb.request_count{level:prod OR environment:prod*} by {loadbalancer}.as_count()) * 100 > 90',
  message: `Detected a high number of non-200 responses for ALB {{loadbalancer.name}}

${notify({ pages: true })}`,
  monitorThresholds: {
    critical: '90',
    warning: '60',
  },
  onMissingData: 'show_no_data',
  notifyAudit: false,
  includeTags: false,
  newGroupDelay: 0,
  evaluationDelay: 900,
  requireFullWindow: false,
});

// https://us5.datadoghq.com/monitors/16891631
adopted('alb-low-healthy-hosts', {
  name: 'Application load balancer low healthy host count',
  type: 'query alert',
  query:
    'avg(last_1h):abs(avg:aws.applicationelb.healthy_host_count{*} by {loadbalancer}) <= 0.25',
  message: `The application load balancer for {{loadbalancer.name}} has low healthy host count.

${notify({ pages: true })}`,
  monitorThresholds: {
    critical: '0.25',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});

// On a near-idle load balancer one slow request is enough to push the hourly
// average past 3s: in the 30 days to 2026-11-10, 27 of this monitor's 28
// alerts came from load balancers that had served under 30 requests in that
// hour, and the other from a dev one. The latency monitor and a request floor
// notify no one; the composite alerts when both hold for a load balancer.
const PROD_ALBS =
  '(level:prod OR environment:prod*) AND NOT name:proxy-service-alb-prod-153de67 AND NOT name:store-service-alb-prod-4db6301';

// https://us5.datadoghq.com/monitors/16891718
const slow = adopted('alb-high-response-time', {
  name: '[PROD] ALB {{loadbalancer.name}} average response time above 3s (composite input)',
  type: 'query alert',
  query: `avg(last_1h):avg:aws.applicationelb.target_response_time.average{${PROD_ALBS}} by {loadbalancer} > 3`,
  message:
    'Input to `[PROD] ALB {{loadbalancer.name}} slow under load`, which notifies; this monitor notifies no one.',
  monitorThresholds: {
    critical: '3',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});

const busy = new datadog.Monitor(
  'alb-request-floor',
  {
    name: '[PROD] ALB {{loadbalancer.name}} served 100+ requests in an hour (composite input)',
    type: 'query alert',
    query: `sum(last_1h):sum:aws.applicationelb.request_count{${PROD_ALBS}} by {loadbalancer}.as_count() >= 100`,
    message:
      'Input to `[PROD] ALB {{loadbalancer.name}} slow under load`, which notifies; this monitor notifies no one. Alert here means the load balancer has enough traffic for its latency to count.',
    tags: ['env:prod', 'service:alb'],
    monitorThresholds: {
      critical: '100',
    },
    renotifyInterval: RENOTIFY_MINUTES,
    requireFullWindow: false,
    onMissingData: 'default',
    notifyAudit: false,
    includeTags: true,
    newGroupDelay: 60,
    evaluationDelay: 900,
  },
  { dependsOn: goalertWebhooks }
);

new datadog.Monitor(
  'alb-slow-under-load',
  {
    name: '[PROD] ALB {{loadbalancer.name}} slow under load',
    type: 'composite',
    query: pulumi.interpolate`${slow.id} && ${busy.id}`,
    message: `Load balancer {{loadbalancer.name}} averaged over 3s target response time for an hour while serving at least 100 requests.

${notify({ pages: false })}`,
    tags: ['env:prod', 'service:alb'],
    priority: '3',
    renotifyInterval: RENOTIFY_MINUTES,
    includeTags: true,
    notifyAudit: false,
  },
  { dependsOn: goalertWebhooks }
);
