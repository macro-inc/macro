# Gmail Refresh Handler

To keep inbox update push notifications coming from email providers, we need to hit provider-specific endpoints like
[users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch) for each 
subscribed user once per day. The refresh handler is triggered by eventbridge once per hour, grabbing a subset 
of the emails that we have a subscription active for. It puts these emails on an SQS queue, which then get picked 
up by a listener in email-service that hits the necessary endpoint for each email. Each email is processed once per day.

Once per day it also applies the retention policy for idle links. A link's activity is the later of the last time
someone who can access it opened the app (`email_links.last_active_at`) and its last thread view. Links idle for
`PAUSE_INACTIVE_AFTER_DAYS` get a `PauseSync` message, which stops syncing but keeps the data; opening the app resumes
them. Paused links idle for `DELETE_INACTIVE_AFTER_DAYS` get a `DeleteLink` message, which the link manager skips if
activity resumed the link in the meantime.
