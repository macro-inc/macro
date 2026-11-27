# Queue alerts

Runbook for the SQS and Kafka consumer lag monitors in
[`monitors/queues.ts`](../../infra/stacks/monitoring/monitors/queues.ts).

## Dead letters

Messages arrived in a prod dead-letter queue. Most DLQs hold old messages
permanently, so the alert counts new arrivals, not depth.

- Read a few messages from the DLQ (`aws sqs receive-message` with a short
  visibility timeout, so they return to the queue) and find the consumer's
  error logs for the same ids around the time they moved.
- Check the consumer's latest deploy: a new message shape or a bug failing
  every message moves them all to the DLQ after the retry limit.
- Levers: fix and deploy the consumer, then redrive the DLQ to the source queue
  (SQS console → Start DLQ redrive). Do not redrive before the fix; the
  messages come straight back.

## Backlog

The oldest message in a work queue is old, or the email backfill backlog grew
abnormally.

- Check that the consumer is running (`aws.ecs.service.running`) and not
  crashing (task stop reasons, error logs).
- If it is running, check what it waits on. The email workers write to MacroDB
  and call Gmail per mailbox; a slow database or Gmail rate limits stall them.
  See the [MacroDB runbook](macrodb.md).
- A sudden rise in enqueues (`aws.sqs.number_of_messages_sent`) on the backfill
  queue means many mailboxes started backfilling at once, which also loads
  MacroDB.
- The link-maintenance queue backs up every morning while the daily sweep
  purges unused and inactive inboxes; that is expected. Inbox removals people
  ask for use the refresh queue, a work queue, and should not wait.
- Levers: scale the consumer if the database has headroom; otherwise throttle
  the producer or pause the backfill until the database recovers.

## Kafka consumer lag

A consumer group is far behind on a topic (`aws.kafka.sum_offset_lag`, the
committed-offset lag summed over the topic's six partitions), or its lag has
not dropped below 100 events in 24 hours. Topics keep events for 7 days
(`infra/stacks/kafka-cluster/topics.ts`). Once a group's next unread event is
older than that, it is deleted and the group resets to its `INITIAL_OFFSET`:
`Latest` skips the whole retained backlog, `Earliest` only the deleted part,
and neither logs an error. For a group that had caught up on a busy topic, the
day-long alert leaves about six days before that happens; a group replaying a
topic from its start, such as a new `Earliest` group, can have far less.

- Find the group's service: the alert names the group, which is the
  `GROUP_NAME` of its consumer (`rg 'GROUP_NAME: &.*= "<group>"'`); one group
  can run in more than one service.
- Check its running task count (`aws.ecs.service.running`) against its
  autoscaling floor and ceiling in its stack. Most consumers' autoscaling follows
  CPU, not lag (the search indexer's also follows its backlog age), and a deploy can
  reset the desired count to the floor. A group spreads a topic
  over at most six tasks, one per partition; more do no extra work.
- Check for a hot key: the dashboard's most-behind-partition graph
  (`aws.kafka.max_offset_lag`) close to the topic's whole lag means one
  partition holds the backlog, so one task is slow on one key or stuck on one
  event. Its logs and traces show which.
- Check for a producer burst: a wave of new mailbox connections fills
  `macro.email` through the email backfill
  (`aws.sqs.number_of_messages_sent{queuename:email-service-backfill-queue-prod}`,
  [Backlog](#backlog)); `aws.kafka.messages_in_per_sec` is the cluster's whole
  produce rate.
- A group with gaps in its lag is rebalancing: MSK reports lag only while a
  group is stable or empty, so a crash-looping consumer shows missing data,
  not lag.
- A group no running code reads (a renamed `GROUP_NAME`, a topic dropped from
  a subscription) keeps its committed offsets for 7 days after its last member
  leaves, or for a dropped topic, after its last commit there. Its lag grows
  until Kafka expires them. Deleting its offsets or
  muting that group is for the owners.
- Do not read `aws.kafka.estimated_max_time_lag` as event age: it divides
  lag by the current consumption rate and reads years when a consumer slows.
- Levers: scale the consumer up to six tasks if what it writes to has
  headroom, and fix a stuck task or hot key. Catch up before a backlog nears
  7 days; changing retention or a group's offsets is a decision for the
  service's owners.
