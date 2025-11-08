# Gmail Refresh Handler

To keep inbox update push notifications coming from email providers, we need to hit provider-specific endpoints like
[users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch) for each 
subscribed user once per day. The refresh handler is triggered by eventbridge once per hour, grabbing a subset 
of the emails that we have a subscription active for. It puts these emails on an SQS queue, which then get picked 
up by a listener in email-service that hits the necessary endpoint for each email. Each email is processed once per day.