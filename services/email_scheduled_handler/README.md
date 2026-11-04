# Email Scheduled Handler

This Lambda runs every minute and republishes eligible delivery/reconciliation
work from `email_scheduled_messages`. It also selects resolved or superseded
`email_deferred_message_deletions`, including rows with no remaining schedule.
Both use the existing scheduled message queue. The email domain worker reconciles
deferred deletion before claiming delivery; database claims prevent duplicate
submission. Failed queue writes remain eligible for the next scan.
