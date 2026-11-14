# Queue alerts

Runbook for the SQS monitors in
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

The oldest message in a work queue is old, or the email backfill queue is not
draining.

- "Email backfill queue not draining" means the oldest backfill message has
  stayed over 15 minutes old for 30 minutes: messages are waiting, not just
  arriving. A burst of thousands of visible messages is normal on this queue
  and drains within a minute or two when sends and deletes keep pace, so the
  visible count alone is not a reason to act. If age keeps climbing, "Email
  backfill queue falling behind" warns once it averages an hour.
- Check that the consumer is running (`aws.ecs.service.running`) and not
  crashing (task stop reasons, error logs).
- If it is running, check what it waits on. The email workers write to MacroDB
  and call Gmail per mailbox; a slow database or Gmail rate limits stall them.
  See the [MacroDB runbook](macrodb.md).
- A sudden rise in enqueues (`aws.sqs.number_of_messages_sent`) on the backfill
  queue means many mailboxes started backfilling at once, which also loads
  MacroDB.
- Levers: scale the consumer if the database has headroom; otherwise throttle
  the producer or pause the backfill until the database recovers.
