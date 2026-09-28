// Application load balancers.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// https://us5.datadoghq.com/monitors/1062605
adopted('alb-non-200-responses', {
  name: '[PROD] Load Balancer Non-200 Responses',
  type: 'query alert',
  query:
    'sum(last_1h):(sum:aws.applicationelb.httpcode_elb_5xx{level:prod OR environment:prod*} by {loadbalancer}.as_count() / sum:aws.applicationelb.request_count{level:prod OR environment:prod*} by {loadbalancer}.as_count()) * 100 > 90',
  message: `Detected a high number of non-200 responses for ALB {{loadbalancer.name}}

@hutch@macro.com
@evan@macro.com 

{{#is_alert}}
@slack-holy-shit-alarms 
{{/is_alert}}
{{#is_alert_recovery}}
@slack-holy-shit-alarms
{{/is_alert_recovery}}

@slack-monitoring


@slack-monitoring`,
  monitorThresholds: {
    critical: '90',
    warning: '60',
  },
  onMissingData: 'show_no_data',
  notifyAudit: false,
  includeTags: false,
  newGroupDelay: 0,
  evaluationDelay: 900,
  renotifyInterval: 0,
  requireFullWindow: false,
});

// https://us5.datadoghq.com/monitors/16891631
adopted('alb-low-healthy-hosts', {
  name: 'Application load balancer low healthy host count',
  type: 'query alert',
  query:
    'avg(last_1h):abs(avg:aws.applicationelb.healthy_host_count{*} by {loadbalancer}) <= 0.25',
  message: `The application load balancer for {{loadbalancer.name}} has low healthy host count.


@hutch@macro.com 
@evan@macro.com`,
  monitorThresholds: {
    critical: '0.25',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/16891718
adopted('alb-high-response-time', {
  name: 'High average response time for alb {{loadbalancer.name}}',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.applicationelb.target_response_time.average{! name:proxy-service-alb-prod-153de67 , ! name:store-service-alb-prod-4db6301} by {loadbalancer} > 3',
  message: `Loadbalancer {{loadbalancer.name}} has a high average response time

@hutch@macro.com`,
  monitorThresholds: {
    critical: '3',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});
