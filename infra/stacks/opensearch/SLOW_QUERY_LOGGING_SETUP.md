# OpenSearch Slow Query Logging Setup

This PR adds CloudWatch logging for OpenSearch slow queries to help diagnose performance issues.

## What's Changed

### Infrastructure (Pulumi)
- Added 3 CloudWatch Log Groups for OpenSearch logs
- Configured log publishing options on the OpenSearch domain

### Helper Script
- Added `configure_slow_logs.ts` to set query threshold settings

## How to Deploy

### 1. Deploy Infrastructure
```bash
cd infra/stacks/opensearch
pulumi up
```

**Note**: This will trigger an OpenSearch domain update (15-30 minutes).

### 2. Configure Query Thresholds

After deployment, run the configuration script:

```bash
cd helpers/scripts
npx ts-node configure_slow_logs.ts
```

This configures all indices to log:
- **WARN**: Queries > 1s
- **INFO**: Queries > 500ms
- **DEBUG**: Queries > 200ms
- **TRACE**: Queries > 100ms

## Viewing Logs

### CloudWatch Console
Navigate to: CloudWatch → Log groups → `/aws/opensearch/domains/macro-opensearch-{stack}/search-slow-logs`

### DataDog (if integrated)
Search: `service:opensearch source:cloudwatch`

## Log Format Example

```json
{
  "type": "index_search_slowlog",
  "timestamp": "2026-02-09T12:00:00.000Z",
  "level": "WARN",
  "took": "1.2s",
  "took_millis": "1200",
  "source": "{\"query\":{...}}",
  "message": "[index_name][0]"
}
```

## Benefits

- Identify slow OpenSearch queries in production
- Diagnose performance bottlenecks
- Set up alerts for queries exceeding thresholds
- Minimal performance impact (async logging)

## Related Issues

Helps diagnose slow search queries identified in trace analysis where `search_unified` took 15s but database queries were fast, indicating OpenSearch as the bottleneck.
