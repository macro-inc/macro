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
- Levers: scale the consumer if the database has headroom; otherwise throttle
  the producer or pause the backfill until the database recovers.
