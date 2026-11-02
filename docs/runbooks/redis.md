# Redis alerts

Runbook for the ElastiCache monitors in
[`monitors/redis.ts`](../../infra/stacks/monitoring/monitors/redis.ts): memory used,
memory forecast, and evictions, per node of every prod cache.

## Memory

The prod caches run `volatile-lru`, which evicts only keys with a TTL. When
most keys have no TTL, a full cache rejects writes (`OOM command not allowed`)
instead of evicting, and every feature that writes to it fails.

Start in three places:

1. **Key mix.** Sample keys by prefix on a replica (`redis-cli --scan
   --pattern '<prefix>*' | head`, `MEMORY USAGE <key>`) and count keys without
   a TTL (`TTL <key>` returns `-1`). A single prefix growing without a TTL is
   the usual cause.
2. **Growth over time.** Graph `aws.elasticache.database_memory_usage_percentage`
   and `aws.elasticache.curr_items` over the last month. Steady linear growth
   points at a key family that is written and never deleted.
3. **Evictions.** `aws.elasticache.evictions` above zero means the cache is
   already full and dropping keys that do have a TTL.

Levers:

- Delete or expire the runaway key family (in batches, with `SCAN` and
  `UNLINK`, never `KEYS`).
- Resize the node type. A resize can move the primary to another node, and
  services that connect to a node endpoint rather than the primary endpoint
  then get `READONLY` errors until it fails back.
- Fix the writer so the keys get a TTL or are deleted when no longer
  referenced.
