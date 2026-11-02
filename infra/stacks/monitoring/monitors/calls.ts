// Native call pushes (crates/notification/src/domain/service/voip.rs).
//
// New monitor, not adopted from the UI, so it is not `protect`ed.
//
// cloud-storage-service (document_storage_service, the only service that
// builds the VoIP push sender) publishes iOS PushKit and Android FCM call
// pushes itself and logs "voip push: SNS delivery failed" for each rejected publish.
// The callee then gets an ordinary alert instead of a ringing phone, and
// nothing else errors. Every Android call push failed this way until #8880
// granted the task role `sns:Publish` on the FCM platform application: 11
// failures in the 30 days to 2026-10-27, far below the DSS error-log monitor's
// 150 per 5 minutes. Call volume is that low, so a single failure alerts.
//
// Pushes to stale device registrations are expected after an uninstall. SNS
// rejects them as disabled or missing endpoints, and `@error` carries the
// `PushEndpointUnavailable` context text, so they are excluded.
import * as datadog from '@pulumi/datadog';
import { goalertWebhooks } from '../goalert';
import { notify, RENOTIFY_MINUTES } from '../notify';

export const nativeCallPushFailing = new datadog.Monitor(
  'native-call-push-failing',
  {
    name: '[PROD] Native call pushes failing',
    type: 'log alert',
    query:
      'logs("service:cloud-storage-service env:prod \\"voip push: SNS delivery failed\\" -@error:*disabled?or?no?longer?exists*").index("*").rollup("count").last("1h") >= 1',
    message: `SNS rejected a native call push, so the callee's phone did not ring.

The endpoint ARN in \`@error\` names the platform (\`GCM\` is Android,
\`APNS_VOIP\` is iOS). \`AuthorizationError\` means the cloud-storage-service
task role lacks \`sns:Publish\` on that platform application: add it to
\`snsPlatformArns\` in infra/stacks/cloud-storage-service/index.ts.

- [Failure logs](https://us5.datadoghq.com/logs?query=service%3Acloud-storage-service%20env%3Aprod%20%22voip%20push%3A%20SNS%20delivery%20failed%22)

${notify({ pages: false })}`,
    tags: ['env:prod', 'service:cloud-storage-service'],
    monitorThresholds: { critical: '1' },
    renotifyInterval: RENOTIFY_MINUTES,
    onMissingData: 'default',
    includeTags: false,
    notifyAudit: false,
    enableLogsSample: true,
    groupbySimpleMonitor: false,
  },
  { dependsOn: goalertWebhooks }
);
