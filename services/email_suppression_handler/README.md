# Email Suppression Handler

The email suppression handler is a lambda function trigged on the bounce and complaint events from SES for the macro.com identity.
When triggered, we automatically add the email to the suppression list to ensure we do not send unwanted emails to the user.
