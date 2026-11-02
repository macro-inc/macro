//! Runs the team invite reminder sweep on a schedule.

use std::{sync::Arc, time::Duration};

use crate::domain::team_service::invite_reminders::{INVITE_REMINDER_BATCH, InviteReminderSender};

/// How long after boot the first sweep runs, so a deploy's rolling restart
/// is past before reminders go out.
pub const INVITE_REMINDER_SWEEP_INITIAL_DELAY: Duration = Duration::from_secs(5 * 60);

/// How often the sweep runs after that. Reminders are days apart, so an hour
/// late costs nothing.
pub const INVITE_REMINDER_SWEEP_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Sweeps once after `initial_delay`, then every `interval`, until `shutdown`
/// resolves. A full batch sweeps again right away.
///
/// Shutdown is checked between sweeps, never during one: a sweep's claim
/// already counted its reminders as sent, so stopping mid-batch would drop
/// the rest. Replicas may sweep concurrently; each claims different invites.
pub async fn run_invite_reminder_sweep<S: InviteReminderSender>(
    sender: Arc<S>,
    initial_delay: Duration,
    interval: Duration,
    shutdown: impl Future<Output = ()> + Send,
) {
    tokio::pin!(shutdown);
    let mut wait = initial_delay;
    loop {
        tokio::select! {
            () = &mut shutdown => return,
            () = tokio::time::sleep(wait) => {}
        }
        wait = match sender.send_due_invite_reminders().await {
            Ok(report) => {
                tracing::info!(
                    claimed = report.claimed,
                    sent = report.sent,
                    failed = report.failed,
                    "team invite reminder sweep finished"
                );
                if i64::try_from(report.claimed)
                    .is_ok_and(|claimed| claimed >= INVITE_REMINDER_BATCH)
                {
                    Duration::ZERO
                } else {
                    interval
                }
            }
            Err(error) => {
                tracing::warn!(error = ?error, "team invite reminder sweep failed");
                interval
            }
        };
    }
}

#[cfg(test)]
mod test;
