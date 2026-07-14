//! Mailpit endpoints for the run summary. The container itself is defined by
//! the compose override; mail is routed to it via the `ses_client` SMTP
//! transport (`SMTP_HOST=mailpit`).

use super::instance::{Instance, Port};

/// The directly published Mailpit web UI used by attached `run_local`.
pub fn direct_ui_url(instance: &Instance) -> String {
    format!("http://localhost:{}", instance.port(Port::MailpitUi))
}

/// The single-origin Mailpit route used by headless stacks and previews.
pub fn proxy_ui_url(instance: &Instance) -> String {
    format!("{}/mailpit/", super::proxy::url(instance))
}
