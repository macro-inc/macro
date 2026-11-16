//! Nightly CRM cleanup worker. An EventBridge cron sends a static `StartJob`
//! payload straight to the queue; the email domain manages the job snapshot,
//! candidate pages, teardown decisions and follow-up messages. This listener
//! decodes deliveries and performs the domain's selected acknowledgement.

mod process;
pub mod worker;
