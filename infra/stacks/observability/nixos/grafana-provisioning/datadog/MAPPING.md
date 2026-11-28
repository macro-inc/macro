# Datadog monitors in Grafana

Generated from `infra/stacks/observability/nixos/grafana-provisioning/datadog/`
by `nix run .#render` in `infra/k8s/observability/cluster`; edit those files.

Datadog monitors from `infra/stacks/monitoring/monitors/`, by source file,
and the Grafana alert rules each became; a monitor not listed is not ported
yet. Ported rules run in shadow, in the folder
`Datadog shadow` with the label `shadow=datadog`: they notify GoAlert's
Notify service and never page, and a monitor that sends nothing in Datadog
sends nothing here. A group moves to paging once its rules have fired when
Datadog did.

How a rule reads: each input is queried over its window, ending its delay
before now (Datadog's evaluation delay), and reduced to one value per
series; the value is computed from them, and the rule fires when it passes
the threshold. Warning and critical are exclusive bands. No datapoints
never fires unless noted. Rule state history is in Loki,
`{from="state-history", group=~"Datadog .*"} | json`.

How a comparison reads: a replay evaluates the rule as rendered once a
minute against CloudWatch's one-minute history and lines it up, group by
group, with Datadog's alert events, from the state each Datadog group was
in when the window opened. Episodes (a run of warning or critical minutes)
match when they overlap within 10 minutes. The replay reads complete data
on minute boundaries, which Grafana evaluating live doesn't, so a minute of
lead or lag is within its error. Live is the rule running in Grafana.

Of 24 monitors, 20 are ported and 4 not.

| Monitor | Datadog | Route | Grafana |
| --- | --- | --- | --- |
| `computer-billing-removal-abandoned-prod` | not deployed | page | ported, 1 rule |
| `computer-purchase-refund-abandoned-prod` | not deployed | page | ported, 1 rule |
| `computer-purchase-refund-unmatched-prod` | not deployed | page | ported, 1 rule |
| `computer-needs-operator-prod` | not deployed | page | ported, 1 rule |
| `stripe-inbox-dead-letter-prod` | not deployed | page | ported, 1 rule |
| `stripe-inbox-backlog-prod` | not deployed | page | ported, 1 rule |
| `rds-proxy-connections` | [1076524](https://us5.datadoghq.com/monitors/1076524) | page | ported, 1 rule |
| `rds-high-cpu` | [1062630](https://us5.datadoghq.com/monitors/1062630) | page | ported, 2 rules |
| `rds-storage-utilization` | [6120132](https://us5.datadoghq.com/monitors/6120132) | page | ported, 18 rules |
| `ses-complaint-rate` | [4178105](https://us5.datadoghq.com/monitors/4178105) | page | ported, 1 rule |
| `ses-bounce-rate` | [1333601](https://us5.datadoghq.com/monitors/1333601) | page | ported, 2 rules |
| `ses-high-email-sends` | [4757927](https://us5.datadoghq.com/monitors/4757927) | page | ported, 2 rules |
| `macro-cache-available-memory-low` | [1062487](https://us5.datadoghq.com/monitors/1062487) | page | ported, 2 rules |
| `graphql-soup-dss-5xx` | [23404593](https://us5.datadoghq.com/monitors/23404593) | page | ported, 2 rules |
| `graphql-soup-db-connections` | [23404592](https://us5.datadoghq.com/monitors/23404592) | page | ported, 2 rules |
| `alb-low-healthy-hosts` | [16891631](https://us5.datadoghq.com/monitors/16891631) | page | ported, 2 rules |
| `alb-non-200-responses` | [1062605](https://us5.datadoghq.com/monitors/1062605) | page | ported, 4 rules |
| `lambda-error-count` | [1065393](https://us5.datadoghq.com/monitors/1065393) | page | ported, 2 rules |
| `web-app-source-errors-prod` | [1189349](https://us5.datadoghq.com/monitors/1189349) | page | not ported |
| `ai-provider-account-unavailable` | not deployed | page | ported, 1 rule |
| `firecracker-golden-secret-refused` | not deployed | page | not ported |
| `firecracker-host-memory` | not deployed | page | ported, 1 rule |
| `firecracker-host-unhealthy` | not deployed | page | not ported |
| `macrodb-blocked-connections` | [23404623](https://us5.datadoghq.com/monitors/23404623) | page | not ported |

## `monitors/computers.ts`

Rule group `Datadog computers`, every 1m.

### `computer-billing-removal-abandoned-prod`

[PROD] Computers: billing item removal abandoned for {{computer_id.name}} · Datadog not deployed · pages in Datadog

Comparison: Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog.

- Rules: `dd-17d988283a01-crit` (critical, > 0)
- `lines`: instant query. Loki: `sum by (computer_id) (count_over_time({service_name="authentication-service", deployment_environment="prod"} |~ "(?i)\\bcomputer billing item removal abandoned\\b" | detected_level="error" [1h]))`
- Value: `$lines`.
- Translation: Datadog's log query in Loki. Prod logs reach Loki as each service's prod sending is turned on; until then this rule has no data.

### `computer-purchase-refund-abandoned-prod`

[PROD] Computers: purchase refund abandoned for {{computer_id.name}} · Datadog not deployed · pages in Datadog

Comparison: Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog.

- Rules: `dd-e3b51c4b8009-crit` (critical, > 0)
- `lines`: instant query. Loki: `sum by (computer_id) (count_over_time({service_name="authentication-service", deployment_environment="prod"} |~ "(?i)\\bcomputer purchase refund abandoned\\b" | detected_level="error" [1h]))`
- Value: `$lines`.
- Translation: Datadog's log query in Loki. Prod logs reach Loki as each service's prod sending is turned on; until then this rule has no data.

### `computer-purchase-refund-unmatched-prod`

[PROD] Computers: no purchase found to refund for {{computer_id.name}} · Datadog not deployed · pages in Datadog

Comparison: Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog.

- Rules: `dd-97f742477089-crit` (critical, > 0)
- `lines`: instant query. Loki: `sum by (computer_id) (count_over_time({service_name="authentication-service", deployment_environment="prod"} |~ "(?i)\\bcomputer purchase refund found no paid purchase\\b" | detected_level="error" [1h]))`
- Value: `$lines`.
- Translation: Datadog's log query in Loki. Prod logs reach Loki as each service's prod sending is turned on; until then this rule has no data.

### `computer-needs-operator-prod`

[PROD] Computers: {{computer_id.name}} needs an operator · Datadog not deployed · pages in Datadog

Comparison: Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog.

- Rules: `dd-50b200295225-crit` (critical, > 0)
- `lines`: instant query. Loki: `sum by (computer_id) (count_over_time({service_name="agent-harness-service", deployment_environment="prod"} |~ "(?i)\\bcomputer needs an operator\\b" | detected_level="error" [15m]))`
- Value: `$lines`.
- Translation: Datadog's log query in Loki. Prod logs reach Loki as each service's prod sending is turned on; until then this rule has no data.

## `monitors/stripe-inbox.ts`

Rule group `Datadog stripe-inbox`, every 1m.

### `stripe-inbox-dead-letter-prod`

[PROD] Stripe inbox: {{consumer.name}} dead-lettered an event · Datadog not deployed · pages in Datadog

Comparison: Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog.

- Rules: `dd-614dae04bc76-crit` (critical, > 0)
- `lines`: instant query. Loki: `sum by (consumer) (count_over_time({service_name="authentication-service", deployment_environment="prod"} |~ "(?i)\\b(stripe inbox cursor dead-lettered|stripe inbox dead cursors)\\b"| detected_level="error" [30m]))`
- Value: `$lines`.
- Translation: Datadog's log query in Loki, per `consumer`. Validated on dev's logs, where the same query finds `personal_plan` dead cursors and `computers` backlog lines. Prod logs reach Loki when authentication-service's prod sending is turned on; until then this rule has no data.

### `stripe-inbox-backlog-prod`

[PROD] Stripe inbox: {{consumer.name}} is applying events late · Datadog not deployed · pages in Datadog

Comparison: Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog.

- Rules: `dd-65ae2dd3f88e-crit` (critical, > 5)
- `lines`: instant query. Loki: `sum by (consumer) (count_over_time({service_name="authentication-service", deployment_environment="prod"} |~ "(?i)\\b(stripe inbox backlog)\\b" [15m]))`
- Value: `$lines`.
- Translation: Datadog's log query in Loki, per `consumer`. Validated on dev's logs, where the same query finds `personal_plan` dead cursors and `computers` backlog lines. Prod logs reach Loki when authentication-service's prod sending is turned on; until then this rule has no data.

## `monitors/rds.ts`

Rule group `Datadog rds`, every 1m.

### `rds-proxy-connections`

[PROD] Excessive concurrent connections in rds proxy · Datadog [1076524](https://us5.datadoghq.com/monitors/1076524) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: Grafana's rule errored on every evaluation until its metric math query got a statistic (Grafana refuses a CloudWatch query without one). Since that reached Grafana at 2026-11-28 00:04, state history records no Error or NoData state for it, and neither system has fired.

- Rules: `dd-808d1b622224-crit` (critical, > 500)
- `connections`: mean over 1h, 15m late. CloudWatch us-east-1: `SUM(SEARCH('Namespace="AWS/RDS" MetricName="DatabaseConnections" ProxyName="macrodb-proxy-prod" TargetGroup="default"', 'Sum', 60)) / DATAPOINT_COUNT(SEARCH('Namespace="AWS/RDS" MetricName="DatabaseConnections" ProxyName="macrodb-proxy-prod" TargetGroup="default"', 'Sum', 60))`
- Value: `$connections`.
- Translation: Datadog's `aws.rds.proxy.database_connections` is CloudWatch's per-minute Sum (not Average) of each of the proxy's target series (read-write role, read-only role, target), averaged across the ones that reported each minute (CloudWatch's `AVG` would count a gap as 0): about 54 when Datadog showed 54.08.

### `rds-high-cpu`

[PROD] RDS High CPU Utilization · Datadog [1062630](https://us5.datadoghq.com/monitors/1062630) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither, on either instance. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.

- Rules: `dd-806199e4c9a9-crit` (critical, >= 95), `dd-806199e4c9a9-warn` (warning, >= 80)
- `cpu`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS CPUUtilization {DBInstanceIdentifier=fusionauthdb-prod|macro-db-prod} Average` per minute
- Value: `$cpu`.
- Translation: Datadog's `name:*-prod` as the instances it matches today, fusionauthdb-prod and macro-db-prod; an instance added later needs adding here.

### `rds-storage-utilization`

[AWS] RDS Storage utilization is high · Datadog [6120132](https://us5.datadoghq.com/monitors/6120132) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: macro-db-prod and its replica warned from 11-27 00:52 and 00:21 in Datadog and a minute later in Grafana, and were still warning at the end; the other six instances fired in neither. macro-db-dev grew from 50 to 100 GiB in five storage autoscaling steps on 11-26 and 11-27 (Datadog's `aws.rds.total_storage_space`), and Datadog warned for 3 to 5½ hours each time, ending 1 to 1¾ hours after the resize. A fixed size can't follow that: replayed with 100 GiB throughout, Grafana reads the instance fuller than it was, in warning or critical for 52 of the last 58 hours (19 of them critical) against Datadog's 23 in warning. Replayed dividing by Datadog's size at each hour instead, Grafana's five episodes start a minute after Datadog's, and the four that end inside the window end 2 to 4 minutes after; but Grafana reads critical for 38 to 61 minutes around each resize (known only to the hour), while the hour's average still holds free space from before it. macro-db-dev is now at 100 GiB, its autoscaling maximum, so its size here holds; macro-db-prod and both replicas can still grow past theirs. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: from the first evaluation Grafana warned on the same three instances as Datadog; macro-db-dev recovered at 00:02 in Grafana (still dividing by 90 GiB) and 00:09 in Datadog, and at 00:48 both warn on macro-db-prod and its replica.

#### fusionauth-db-dev

- Rules: `dd-7a8c9322574f-crit` (critical, > 90), `dd-7a8c9322574f-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=fusionauth-db-dev} Average` per minute
- Value: `100 - $free / (20 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (20 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

#### fusionauthdb-prod

- Rules: `dd-214ae4d129a8-crit` (critical, > 90), `dd-214ae4d129a8-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=fusionauthdb-prod} Average` per minute
- Value: `100 - $free / (50 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (50 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

#### macro-connect-dev-db

- Rules: `dd-6e1656b084e4-crit` (critical, > 90), `dd-6e1656b084e4-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=macro-connect-dev-db} Average` per minute
- Value: `100 - $free / (20 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (20 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

#### macro-connect-prod-db

- Rules: `dd-76ac4511e529-crit` (critical, > 90), `dd-76ac4511e529-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=macro-connect-prod-db} Average` per minute
- Value: `100 - $free / (20 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (20 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

#### macro-db-dev

- Rules: `dd-a8efb4582845-crit` (critical, > 90), `dd-a8efb4582845-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=macro-db-dev} Average` per minute
- Value: `100 - $free / (100 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (100 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

#### macro-db-dev-read-replica

- Rules: `dd-424a1be15bdc-crit` (critical, > 90), `dd-424a1be15bdc-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=macro-db-dev-read-replica} Average` per minute
- Value: `100 - $free / (50 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (50 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

#### macro-db-prod

- Rules: `dd-470ac73bfc3e-crit` (critical, > 90), `dd-470ac73bfc3e-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=macro-db-prod} Average` per minute
- Value: `100 - $free / (5000 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (5000 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

#### macro-db-prod-read-replica

- Rules: `dd-ad8ff8fc3872-crit` (critical, > 90), `dd-ad8ff8fc3872-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=macro-db-prod-read-replica} Average` per minute
- Value: `100 - $free / (5000 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (5000 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

#### observability-grafana

- Rules: `dd-c0512b015dbc-crit` (critical, > 90), `dd-c0512b015dbc-warn` (warning, > 85)
- `free`: mean over 1h, 15m late. CloudWatch us-east-2: `AWS/RDS FreeStorageSpace {DBInstanceIdentifier=observability-grafana} Average` per minute
- Value: `100 - $free / (20 * 1073741824) * 100`.
- Translation: Datadog's `{*} by {dbinstanceidentifier,engine}` as a rule per instance, with its allocated storage written in rds.nix (20 GiB): CloudWatch has free space but not the total. Storage autoscaling makes that number stale.

## `monitors/ses.ts`

Rule group `Datadog ses`, every 1m.

### `ses-complaint-rate`

[SES] Complaint Rate Increasing · Datadog [4178105](https://us5.datadoghq.com/monitors/4178105) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.

- Rules: `dd-5141d47ef5d2-crit` (critical, > 0.005)
- `ses`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/SES Reputation.ComplaintRate {} Average` per minute
- Value: `$ses`.
- Translation: The account's reputation metric, the only SES account Datadog reads: 0.0047 in both when compared.

### `ses-bounce-rate`

[SES] Bounce Rate Increasing · Datadog [1333601](https://us5.datadoghq.com/monitors/1333601) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: both start in the warning Datadog opened on 2026-11-10 21:15 UTC; Datadog ended it at 11-16 15:18 and Grafana a minute later, and neither fired again. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.

- Rules: `dd-8ddffa06f549-crit` (critical, > 0.05), `dd-8ddffa06f549-warn` (warning, > 0.03)
- `ses`: mean over 1h, 15m late. CloudWatch us-east-1: `AWS/SES Reputation.BounceRate {} Average` per minute
- Value: `$ses`.
- Translation: The account's reputation metric: 0.0247 here when Datadog showed 0.0246.

### `ses-high-email-sends`

[SES] HIGH EMAIL SENDS · Datadog [4757927](https://us5.datadoghq.com/monitors/4757927) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: Datadog warned twice on 11-20, at 22:29 for 3 minutes and at 22:36 for 7; Grafana warned a minute later each time, for the same lengths, and neither went critical. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.

- Rules: `dd-2ac9f2f73291-crit` (critical, > 250), `dd-2ac9f2f73291-warn` (warning, > 200)
- `ses`: sum over 1h, 15m late. CloudWatch us-east-1: `AWS/SES Send {} Sum` per minute
- Value: `$ses`.
- Translation: Sends summed over the hour, as Datadog's `sum(last_1h)` of per-minute sums (`aws.ses.send.sum`). Datadog groups by account, but has SES data from one, the account Grafana reads, and only in us-east-1; CloudWatch has no SES sends in us-east-2, us-west-2 or eu-west-1: 37 in both when compared.

## `monitors/cache.ts`

Rule group `Datadog cache`, every 1m.

### `macro-cache-available-memory-low`

[PROD] Macro Cache Available Memory Low · Datadog [1062487](https://us5.datadoghq.com/monitors/1062487) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: Grafana's rules errored on every evaluation until their metric math query got a statistic (Grafana refuses a CloudWatch query without one). Since that reached Grafana at 2026-11-28 00:04, state history records no Error or NoData state for them, and neither system has fired.

- Rules: `dd-aa7ed1a64641-crit` (critical, > 90), `dd-aa7ed1a64641-warn` (warning, > 80)
- `memory`: mean over 1h, 15m late. CloudWatch us-east-1: `SUM(SEARCH('{AWS/ElastiCache,CacheClusterId} MetricName="DatabaseMemoryUsagePercentage" (CacheClusterId="macro-cache-prod-001" OR CacheClusterId="macro-cache-prod-002")', 'Average', 60)) / DATAPOINT_COUNT(SEARCH('{AWS/ElastiCache,CacheClusterId} MetricName="DatabaseMemoryUsagePercentage" (CacheClusterId="macro-cache-prod-001" OR CacheClusterId="macro-cache-prod-002")', 'Average', 60))`
- Value: `$memory`.
- Translation: Datadog's `name:macro-cache-prod*` as the two nodes it matches today, averaged as Datadog's ungrouped `avg:` does, over the nodes that reported each minute (CloudWatch's `AVG` would count a gap as 0): 18.50 in both when compared. A node added later needs adding here.

## `monitors/graphql-soup.ts`

Rule group `Datadog graphql-soup`, every 1m.

### `graphql-soup-dss-5xx`

[PROD] GraphQL soup: cloud-storage-service target group 5xx · Datadog [23404593](https://us5.datadoghq.com/monitors/23404593) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: each of Datadog's 129 warning or critical episodes overlaps a Grafana one, which starts a median minute earlier and ends a minute later, 106 of them within 5 minutes at both ends; 115 of Grafana's 118 overlap a Datadog one, and the other 3 lasted 1 to 2 minutes. Same state (OK, warning, critical) in 98.3% of minutes. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.

- Rules: `dd-62f0debe358f-crit` (critical, > 25), `dd-62f0debe358f-warn` (warning, > 10)
- `errors`: sum over 15m. CloudWatch us-east-1: `AWS/ApplicationELB HTTPCode_Target_5XX_Count {LoadBalancer=app/prod-gateway-alb/8e99d35bdc70b1c9, TargetGroup=targetgroup/prod-cloud-storage-service-tg/efcc30d4d72a4d50} Sum` per minute
- Value: `$errors`.
- Translation: The target group's 5xx count on prod-gateway-alb, its only load balancer, summed over 15 minutes. No 5xx means no datapoints, which is OK.

### `graphql-soup-db-connections`

[PROD] GraphQL soup: macro-db-prod connections high · Datadog [23404592](https://us5.datadoghq.com/monitors/23404592) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: 66 of Datadog's 70 warning episodes overlap one of Grafana's 52, which runs some of Datadog's short flaps together; they start and end a median 0 minutes apart, 48 within 5 minutes at both ends. Grafana missed four Datadog flaps of 1 to 3 minutes (11-18 17:33, 11-19 01:01, 11-24 12:17 and 12:20), and every Grafana episode overlaps a Datadog one. Same state in 99.6% of minutes, critical in neither. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.

- Rules: `dd-add1694e3413-crit` (critical, > 1400), `dd-add1694e3413-warn` (warning, > 1100)
- `connections`: mean over 15m. CloudWatch us-east-1: `AWS/RDS DatabaseConnections {DBInstanceIdentifier=macro-db-prod} Average` per minute
- Value: `$connections`.
- Translation: The same CloudWatch metric Datadog reads. Datadog sees it after its AWS crawl, minutes late, and has no evaluation delay, so its last minutes are often empty; Grafana reads CloudWatch directly.

## `monitors/load-balancer.ts`

Rule group `Datadog load-balancer`, every 1m.

### `alb-low-healthy-hosts`

Application load balancer low healthy host count · Datadog [16891631](https://us5.datadoghq.com/monitors/16891631) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC, with SEARCH over 5-minute averages, since Metrics Insights reaches back only 3 hours: fired in neither, on any of the 27 load balancers in both regions. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: Grafana's rules errored on every evaluation until their Metrics Insights query got a statistic (Grafana refuses a CloudWatch query without one). Since that reached Grafana at 2026-11-28 00:04, state history records no Error or NoData state for them, and neither system has fired.

#### us-east-1

- Rules: `dd-9445d11877c5-crit` (critical, <= 0.25)
- `healthy`: mean over 1h, 15m late. CloudWatch Metrics Insights us-east-1: `SELECT AVG(HealthyHostCount) FROM SCHEMA("AWS/ApplicationELB", AvailabilityZone, LoadBalancer, TargetGroup) GROUP BY LoadBalancer`
- Value: `abs($healthy)`.
- Translation: Healthy hosts per target group and zone, averaged per load balancer as Datadog does (1.57 for prod-gateway-alb in both when compared), for every load balancer in the region, dev too, as Datadog's `{*}`; a rule per region. The series label is the load balancer.

#### us-east-2

- Rules: `dd-31c39ec76c2f-crit` (critical, <= 0.25)
- `healthy`: mean over 1h, 15m late. CloudWatch Metrics Insights us-east-2: `SELECT AVG(HealthyHostCount) FROM SCHEMA("AWS/ApplicationELB", AvailabilityZone, LoadBalancer, TargetGroup) GROUP BY LoadBalancer`
- Value: `abs($healthy)`.
- Translation: Healthy hosts per target group and zone, averaged per load balancer as Datadog does (1.57 for prod-gateway-alb in both when compared), for every load balancer in the region, dev too, as Datadog's `{*}`; a rule per region. The series label is the load balancer.

### `alb-non-200-responses`

[PROD] Load Balancer Non-200 Responses · Datadog [1062605](https://us5.datadoghq.com/monitors/1062605) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: fired in neither, on any of the 12 load balancers. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.

#### us-east-1

- Rules: `dd-053394bce620-crit` (critical, > 90), `dd-053394bce620-warn` (warning, > 60)
- `errors`: sum over 1h, 15m late. CloudWatch us-east-1: `AWS/ApplicationELB HTTPCode_ELB_5XX_Count {LoadBalancer=app/authentication-service-alb-prod/c238552e2c16f0e5|app/convert-service-alb-prod/48ced5a77f1728bc|app/document-processing-alb-prod/868781496a437fe3|app/fusionauth-alb-prod/a700e4b7eedde8bc|app/macro-compare-service-lb/1403c0c4572b1193|app/macro-connect-prod-alb-6b22a57/41074eb7b1361a9b|app/macro-convert-service-lb/6ea37176f7f205ca|app/macro-gql-service-lb-prod/56da482c282f5e77|app/prod-gateway-alb/8e99d35bdc70b1c9|app/pvgw-http-prod-c1f9698/a8ce0455a73fcc7b|app/static-file-service-alb-prod/1fb34755c33ec300} Sum` per minute
- `requests`: sum over 1h, 15m late. CloudWatch us-east-1: `AWS/ApplicationELB RequestCount {LoadBalancer=app/authentication-service-alb-prod/c238552e2c16f0e5|app/convert-service-alb-prod/48ced5a77f1728bc|app/document-processing-alb-prod/868781496a437fe3|app/fusionauth-alb-prod/a700e4b7eedde8bc|app/macro-compare-service-lb/1403c0c4572b1193|app/macro-connect-prod-alb-6b22a57/41074eb7b1361a9b|app/macro-convert-service-lb/6ea37176f7f205ca|app/macro-gql-service-lb-prod/56da482c282f5e77|app/prod-gateway-alb/8e99d35bdc70b1c9|app/pvgw-http-prod-c1f9698/a8ce0455a73fcc7b|app/static-file-service-alb-prod/1fb34755c33ec300} Sum` per minute
- Value: `$errors / $requests * 100`.
- Translation: The load balancer's own 5xx (not its targets') as a share of its requests over the hour, per load balancer: Datadog's prod set when this was written, a rule per region. A load balancer with no 5xx has no datapoints, which is OK.

#### us-east-2

- Rules: `dd-4a80a77cd96a-crit` (critical, > 90), `dd-4a80a77cd96a-warn` (warning, > 60)
- `errors`: sum over 1h, 15m late. CloudWatch us-east-2: `AWS/ApplicationELB HTTPCode_ELB_5XX_Count {LoadBalancer=app/observability-a77ca6f/fbcdce04c386aea2} Sum` per minute
- `requests`: sum over 1h, 15m late. CloudWatch us-east-2: `AWS/ApplicationELB RequestCount {LoadBalancer=app/observability-a77ca6f/fbcdce04c386aea2} Sum` per minute
- Value: `$errors / $requests * 100`.
- Translation: The load balancer's own 5xx (not its targets') as a share of its requests over the hour, per load balancer: Datadog's prod set when this was written, a rule per region. A load balancer with no 5xx has no datapoints, which is OK.

## `monitors/compute.ts`

Rule group `Datadog compute`, every 1m.

### `lambda-error-count`

[PROD] Lambda Increased Error Count · Datadog [1065393](https://us5.datadoghq.com/monitors/1065393) · pages in Datadog

Comparison: Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: job-update-handler-lambda-prod warned 41 times in both, each episode overlapping one in the other and every Grafana episode starting and ending within a minute of Datadog's; the other 17 functions fired in neither, and neither went critical. Same state in 99.6% of minutes. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.

- Rules: `dd-9b47db78a838-crit` (critical, > 500), `dd-9b47db78a838-warn` (warning, > 100)
- `errors`: sum over 1h, 15m late. CloudWatch us-east-1: `AWS/Lambda Errors {FunctionName=call_recording_preview_handler-prod|dataloss_prevention_handler-prod|document-text-extractor-prod|document-upload-finalizer-lambda-prod|docx-unzip-lambda-prod|docx-upload-job-table-cleanup-lambda-prod|email_refresh_handler-prod|email_scheduled_handler-prod|job-submission-handler-lambda-prod|job-to-dpr-table-cleanup-lambda-prod|job-update-handler-lambda-prod|notification_retention_handler-prod|pdf-preprocess-lambda-prod|search_upload_handler-prod|sha-cleanup-trigger-prod|static-file-service-image-optimizer-prod|ws-connection-init-handler-lambda-prod|ws-ping-response-handler-prod} Sum` per minute
- Value: `$errors / 60`.
- Translation: Errors per function over the hour, divided by 60 as Datadog's `.as_rate()` of a `sum(last_1h)` comes out. The functions are Datadog's tag selection when this was written: a new prod function needs adding here.

## `monitors/rum.ts`

No rule group: none of its monitors listed here is ported.

### `web-app-source-errors-prod`

[PROD] Web-App Source Error · Datadog [1189349](https://us5.datadoghq.com/monitors/1189349) · pages in Datadog

Not ported. It counts distinct RUM views with source errors against all views, and nothing in Grafana records browser views: the web app's telemetry has no RUM equivalent there. Datadog has no data for it either (the monitor shows No Data).

## `monitors/ai-providers.ts`

Rule group `Datadog ai-providers`, every 1m.

### `ai-provider-account-unavailable`

[PROD] AI provider account suspended or out of credit · Datadog not deployed · pages in Datadog

Comparison: Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog.

- Rules: `dd-78dcab57915d-crit` (critical, >= 1)
- `unavailable`: instant query. Mimir: `sum by (provider, reason) (sum_over_time(macro_ai_provider_account_unavailable{deployment_environment="prod"}[5m]))`
- Value: `$unavailable`.
- Translation: The derived metric `macro_ai_provider_account_unavailable`, computed from the same log lines. On dev's it finds fireworks `suspended` (29 in a five-minute window this week). Prod logs reach it when agent-harness-service's prod sending is turned on.

## `monitors/firecracker.ts`

Rule group `Datadog firecracker`, every 1m.

### `firecracker-golden-secret-refused`

[PROD] Firecracker golden secret scan refused · Datadog not deployed · pages in Datadog

Not ported. Reads the host agent's `firecracker_host.golden.builds` counter, which reaches only the host's Datadog agent. OTLP sent to the cluster's ingest would keep `host.name` and `deployment.environment` on `target_info`, not on the series, so the labels a rule needs depend on how the host sends them (its Alloy's `host` and `deployment_environment` external labels, as for the fleet dashboard, would do). Port it with that change.

### `firecracker-host-memory`

[PROD] Firecracker host memory above high watermark · Datadog not deployed · pages in Datadog

Comparison: Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog.

- Rules: `dd-8e0cdaa55797-crit` (critical, > 1)
- `pressure`: instant query. Mimir: `avg_over_time((max by (host) (computer_host_memory_used_ratio{deployment_environment="prod"}) / min by (host) (computer_host_memory_high_watermark_ratio{deployment_environment="prod"}))[5m:1m])`
- Value: `$pressure`.
- Translation: Used over high-watermark memory per host, averaged over 5 minutes at one-minute steps, from the gauges agent-harness-service reports per host (`host` is the gauges' own attribute; in Mimir from local stacks). On ECS the telemetry sidecar sets `deployment.environment` on every datapoint (`infra/packages/resources/src/resources/ecs-telemetry.alloy`), so the series carry `deployment_environment` as dev's do today; the sidecar writes `dev` for now, and turning on prod sending sets it from the stack (https://github.com/macro-inc/macro/pull/12204). No data until agent-harness-service's prod sending is turned on.

### `firecracker-host-unhealthy`

[PROD] Firecracker host agent unhealthy · Datadog not deployed · pages in Datadog

Not ported. Reads the host agent's `firecracker_host.ready` gauge, which reaches only the host's Datadog agent; as for the golden secret refusals, port it once the host sends its metrics to the cluster with per-host labels. Datadog's query is the per-host minimum's maximum over 2 minutes, below 1, with a 5-minute no-data alert per host.

## `monitors/macrodb.ts`

No rule group: none of its monitors listed here is ported.

### `macrodb-blocked-connections`

[PROD] macro-db-prod connections blocked on locks · Datadog [23404623](https://us5.datadoghq.com/monitors/23404623) · pages in Datadog

Not ported. Datadog Database Monitoring's blocked connections have no Grafana source yet. The Postgres collector (`nixos/database-collector/`) reads only the dev databases, and its exporter has no series for backends waiting on a lock (`pg_stat_activity_count` has no wait event). Porting needs a collector on macro-db-prod and its replica with a query counting `wait_event_type = 'Lock'` per instance.
