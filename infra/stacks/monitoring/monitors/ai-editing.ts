// AI document editing.
//
// New monitors, not adopted from the UI, so they are not `protect`ed — they can
// be tuned or removed from code freely.
//
// Two independent angles, because each misses what the other catches. The APM
// monitor sees the worker's own view of its requests; the log monitor sees
// document-storage's view, so it still fires when the worker is unreachable and
// reporting no telemetry at all.
//
// Neither covers "the worker answers 200 but silently produces no edits", and
// both are blind while nobody is editing. That needs the hourly canary against
// a fixed document, which is a follow-up: POST /edit requires a short-lived
// `documentToken` (macro_sync_service_jwt), so a probe needs somewhere to mint
// one.
import * as datadog from '@pulumi/datadog';

// The worker's entry span is `http.server.request` with resource_name `POST`.
// Custom spans like `edit.session` do NOT produce trace metrics — Datadog only
// generates them for entry spans, so a monitor on `trace.Internal{...}` here
// would never fire.
export const aiEditingWorkerErrors = new datadog.Monitor(
  'ai-editing-worker-errors',
  {
    name: '[PROD] AI editing worker returning errors',
    type: 'query alert',
    query:
      'sum(last_1h):(sum:trace.http.server.request.errors{service:ai-editing-worker,env:production}.as_count() / sum:trace.http.server.request.hits{service:ai-editing-worker,env:production}.as_count()) * 100 > 50',
    message: `More than {{threshold}}% of AI editing requests are failing.

The worker answers 502 when an edit session throws and 499 when the client
cancels; only the former counts as an error here.

- [Worker traces](https://us5.datadoghq.com/apm/traces?query=service%3Aai-editing-worker%20env%3Aproduction%20status%3Aerror)
- Check provider outages first: the supervisor chain falls back Anthropic ->
  OpenAI, so a single provider failing shows up as latency, not errors.

@slack-monitoring`,
    tags: ['env:prod', 'service:ai-editing-worker', 'product:apm'],
    monitorThresholds: { critical: '50', warning: '20' },
    // Ratio of two count metrics: no traffic means no data, which must not
    // alert. Quiet-hours coverage is the canary's job, not this monitor's.
    onMissingData: 'default',
    evaluationDelay: 60,
    includeTags: true,
    notifyAudit: false,
  }
);

// Emitted by ReqwestEditingWorkerClient::edit when the worker answers non-2xx
// or is unreachable (crates/documents/src/outbound/editing_worker_client.rs).
export const aiEditingRequestsFailing = new datadog.Monitor(
  'ai-editing-requests-failing',
  {
    name: '[PROD] AI editing requests failing from document storage',
    type: 'log alert',
    query:
      'logs("service:cloud-storage-service-prod \\"editing worker returned\\"").index("*").rollup("count").last("15m") > 5',
    message: `document-storage is getting errors back from the AI editing worker.

Unlike the APM monitor this fires even when the worker is unreachable, since it
reads the caller's logs rather than the worker's telemetry.

@slack-monitoring`,
    tags: ['env:prod', 'service:ai-editing-worker'],
    monitorThresholds: { critical: '5', warning: '1' },
    onMissingData: 'default',
    includeTags: false,
    notifyAudit: false,
    enableLogsSample: true,
    groupbySimpleMonitor: false,
  }
);
