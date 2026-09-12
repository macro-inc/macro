// Real User Monitoring alerts on the web app.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// https://us5.datadoghq.com/monitors/1177082
adopted('web-app-errors-staging', {
  name: '[STAGING] Web-App Increased Error Count',
  type: 'rum alert',
  query:
    'rum("@type:error @application.name:\\"Web App\\" env:production @view.url_host:staging.macro.com").rollup("count").last("5m") > 90',
  message: '@slack-monitoring',
  monitorThresholds: {
    critical: '90',
    warning: '50',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  enableLogsSample: false,
  groupbySimpleMonitor: false,
});

// https://us5.datadoghq.com/monitors/1189349
adopted('web-app-source-errors-prod', {
  name: '[PROD] Web-App Source Error',
  type: 'rum alert',
  query: 'formula("(1 - (query - query1) / query) * 100").last("1h") > 90',
  message: `{{value}} % of all views in Web App are throwing errors from source.

@slack-monitoring
{{#is_alert}}@slack-holy-shit-alarms {{/is_alert}}`,
  priority: '2',
  tags: ['prod'],
  monitorThresholds: {
    critical: '90',
    warning: '50',
  },
  onMissingData: 'show_no_data',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  renotifyInterval: 60,
  renotifyStatuses: ['alert'],
  notificationPresetName: 'hide_all',
  enableLogsSample: false,
  groupbySimpleMonitor: false,
  variables: {
    eventQueries: [
      {
        name: 'query',
        dataSource: 'rum',
        computes: [
          {
            aggregation: 'cardinality',
            metric: '@view.id',
          },
        ],
        indexes: ['*'],
        search: {
          query:
            '@type:view (@application.name:"Web App" OR service:web-app) env:production @view.url_host:(macro.com OR www.macro.com)',
        },
      },
      {
        name: 'query1',
        dataSource: 'rum',
        computes: [
          {
            aggregation: 'cardinality',
            metric: '@view.id',
          },
        ],
        indexes: ['*'],
        search: {
          query:
            '@type:error (@application.name:"Web App" OR service:web-app) env:production @view.url_host:(macro.com OR www.macro.com) @error.source:source',
        },
      },
    ],
  },
});
