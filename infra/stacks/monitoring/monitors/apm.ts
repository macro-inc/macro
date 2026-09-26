// APM latency.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// https://us5.datadoghq.com/monitors/19271629
adopted('apm-get-channel-messages-p95', {
  name: 'High p95 Latency – get_channel_messages (cloud-storage-service prod)',
  type: 'query alert',
  query:
    'percentile(last_15m):p95:trace.Internal{service:cloud-storage-service,resource_name:get_channel_messages,env:prod} > 0.1',
  message: `## ⚠️ High p95 Latency on get_channel_messages

**Service:** cloud-storage-service  
**Resource:** get_channel_messages  
**Environment:** prod  

### What's happening?
p95 response time has exceeded **100ms** (threshold). During the Apr 17 incident this reached 322ms.

### What to check?
1. Check for recent ECS deployments on \`cloud-storage-service\` — the Apr 17 spike was caused by a bad task version
2. Look for \`idle_ns >> busy_ns\` in slow spans — indicates DB wait / connection pool exhaustion
3. Check channels \`0195ceb6-ec2e-7023-80e4-6e084fa6cccd\` and \`0195cea4-5491-77f9-9224-1291fdb8f150\` (repeatedly affected in the last incident)
4. Review the \`Sort(CreatedAt)\` query path on backward pagination (\`direction: Older\`)

### Useful Links
- [Slow spans explorer](https://us5.datadoghq.com/apm/traces?query=service%3Acloud-storage-service+resource_name%3Aget_channel_messages+env%3Aprod+%40duration%3A%3E100000000)
- [Investigation notebook](https://us5.datadoghq.com/notebook/277323)`,
  priority: '5',
  tags: [
    'service:cloud-storage-service',
    'env:prod',
    'resource:get_channel_messages',
    'product:apm',
    'team:hutch',
  ],
  monitorThresholds: {
    critical: '0.1',
    warning: '0.05',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newHostDelay: 300,
  evaluationDelay: 60,
  requireFullWindow: false,
});
