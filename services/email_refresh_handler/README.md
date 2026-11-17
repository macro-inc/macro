# Gmail Refresh Handler

To keep inbox update push notifications coming from email providers, we need to hit provider-specific endpoints like
[users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch) for each 
subscribed user once per day. The refresh handler is triggered by eventbridge once per hour, grabbing a subset 
of the emails that we have a subscription active for. It puts these emails on an SQS queue, which then get picked 
up by a listener in email-service that hits the necessary endpoint for each email. Each email is processed once per day.

The Lambda adapter calls the service-local domain in `src/domain/`, which runs
refresh and grant-health selection concurrently. Health checks use an epoch-hour
hash bucket and the configured interval. After both flows finish, a fresh clock
read gates unused/inactive link deletion at UTC hour 5 in production. The clock
reads remain independent so an invocation can cross an hour boundary.

The four PostgreSQL queries and the SQS implementation live in `src/outbound/`.
Deletion reads unused then inactive IDs, sends every unused notification first,
then sends inactive notifications. The producer does not claim or modify rows.
Query failures become empty lists and individual send failures are logged while
processing continues; the Lambda returns success. The link-manager consumer
performs the actual provider calls and link deletion.
