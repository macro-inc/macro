# Type Alias: CreateScheduledAction

> **CreateScheduledAction** = [`ActionConfiguration`](ActionConfiguration.md) \| [`LegacyActionConfiguration`](LegacyActionConfiguration.md)

Exactly one representation is accepted, even if mixed fields agree or are null.

Deserialization prefers the variant that matches the payload (`trigger`
present → canonical) so a field error such as an invalid cron schedule is
not swallowed by the untagged fallback.
