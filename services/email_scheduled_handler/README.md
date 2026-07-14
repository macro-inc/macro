# Email Scheduled Handler

This Lambda function executes every minute to process scheduled emails. It checks for rows in the `scheduled_messages`
table where the `send_time` has passed and publishes a message to the email service's scheduled message worker queue via
PubSub. This triggers the scheduled message worker to process and send the queued email.