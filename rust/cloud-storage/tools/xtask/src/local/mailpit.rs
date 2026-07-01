//! Mailpit endpoints for the run summary. The container itself is defined by
//! the compose override; mail is routed to it via the `ses_client` SMTP
//! transport (`SMTP_HOST=mailpit`).

use super::instance::{Instance, Port};

/// The Mailpit web UI URL (host-facing).
pub fn ui_url(instance: &Instance) -> String {
    format!("http://localhost:{}", instance.port(Port::MailpitUi))
}
