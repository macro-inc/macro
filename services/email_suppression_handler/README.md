# Email Suppression Handler

The email suppression handler is a lambda function trigged on the bounce and complaint events from SES for the macro.com identity.
When triggered, we automatically add the email to the suppression list to ensure we do not send unwanted emails to the user.

The SNS adapter in `src/handler.rs` decodes each message and delegates to the
service-local domain in `src/domain/`. The PostgreSQL adapter calls the existing
blocked-email helper, which lowercases recipients and ignores insert conflicts.

Permanent bounces are suppressed. Transient and undetermined bounces do not
write, while four existing transient subtype combinations panic. For complaints,
a present subtype takes precedence; otherwise abuse, authentication failure,
fraud, virus and other feedback suppress recipients. Not-spam or absent feedback
without a subtype is ignored. Empty recipient lists still reach the helper.

Ordinary record errors are logged and later records continue, with success
returned from the Lambda. A panic stops processing the remaining records;
earlier database writes remain committed.
