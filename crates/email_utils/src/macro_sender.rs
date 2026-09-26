//! Recognition of Macro's own outbound notification sender.
//!
//! Macro's notification service sends digest, invite, and other system
//! emails from `no-reply[-<env>]@notification.macro.com` (the SES identity
//! the notification service is allowed to send from). Users receive those
//! about activity they already see in-app, so the email pipeline treats
//! them as noise and never raises a new-email notification for them.

#[cfg(test)]
mod test;

/// Domain every Macro notification email is sent from, across environments
/// (`no-reply@`, `no-reply-dev@`, ...). Lowercase; compare case-insensitively.
pub const MACRO_NOTIFICATION_SENDER_DOMAIN: &str = "notification.macro.com";

/// Whether `email` is one of Macro's own notification senders, i.e. any
/// address at [`MACRO_NOTIFICATION_SENDER_DOMAIN`].
pub fn is_macro_notification_sender(email: &str) -> bool {
    email
        .trim()
        .rsplit_once('@')
        .is_some_and(|(_, domain)| domain.eq_ignore_ascii_case(MACRO_NOTIFICATION_SENDER_DOMAIN))
}
