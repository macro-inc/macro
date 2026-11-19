//! IMAP worker rollout and recovery scheduling at the composition boundary.

use email::domain::mailbox::runtime::MailboxRuntime;
use feature_flags::{ServiceContext, ServiceFeatureFlags};
use tokio_util::sync::CancellationToken;

/// Refresh the service rollout independently of Outlook's worker switches.
pub fn refresh(
    flags: Option<feature_flags::outbound::posthog::PostHogFeatureFlags>,
    runtime: MailboxRuntime,
    cancellation: CancellationToken,
) -> impl std::future::Future<Output = ()> {
    refresh_inner(flags, runtime, cancellation)
}

async fn refresh_inner(
    flags: Option<feature_flags::outbound::posthog::PostHogFeatureFlags>,
    runtime: MailboxRuntime,
    cancellation: CancellationToken,
) {
    let Some(flags) = flags else { return };
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {biased; _=cancellation.cancelled()=>return,_=interval.tick()=>{}}
        let snapshot = tokio::select! {biased; _=cancellation.cancelled()=>return,snapshot=flags.load_service(ServiceContext::new("imap-mailbox-sync"))=>snapshot};
        match snapshot {
            Ok(snapshot) => runtime.set(
                snapshot.is_enabled("enable-imap-sync"),
                snapshot.is_enabled("enable-imap-writes"),
            ),
            Err(error) => {
                runtime.set(false, false);
                tracing::warn!(error=?error,"IMAP worker rollout unavailable; new work paused");
            }
        }
    }
}

/// Resume durable linking reservations after interruption without retaining passwords.
pub async fn recover<R, G, F>(
    service: email::domain::mailbox::imap_connection::ImapConnectionService<R, G, F>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::imap_connection::ImapConnectionRepository,
    G: email::domain::mailbox::imap_connection::ImapConnectionGateway,
    F: email::domain::mailbox::imap_connection::ImapConnectionEnrollment,
{
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {biased;_=cancellation.cancelled()=>return,_=interval.tick()=>{}}
        tokio::select! {biased;_=cancellation.cancelled()=>return,result=service.recover_once()=>{if let Err(error)=result {tracing::warn!(error=%error,"IMAP connection recovery deferred");}}}
    }
}
