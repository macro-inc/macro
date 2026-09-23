//! Authorize email reads before deriving calendar identities from saved snapshots.
use super::models::calendar_invitation::{
    CalendarInvitation, InvitationDateTime, InvitationMethod,
};
use calendar_events::domain::invitations::{
    CalendarInvitationService, InvitationIdentity, InvitationResolution, InvitationRevision,
    MAX_INVITATION_BATCH,
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use rootcause::Report;
use std::{collections::HashMap, future::Future};
use uuid::Uuid;

/// A saved component with the message and inbox it arrived in.
pub struct ThreadInvitation {
    /// Message carrying the component.
    pub message_id: Uuid,
    /// Inbox the message arrived in.
    pub link_id: Uuid,
    /// Saved component.
    pub invitation: CalendarInvitation,
}

/// Email-owned access-aware lookup of saved scheduling components.
pub trait InvitationSnapshotRepository: Send + Sync {
    /// Newest components of one already-authorized thread, at most `limit`.
    fn thread_invitations(
        &self,
        thread_id: Uuid,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<ThreadInvitation>, Report>> + Send;
    /// Newer scheduling messages for the same UIDs.
    /// Only the authorized thread and independently owned inboxes may contribute.
    fn revisions(
        &self,
        viewer: &str,
        thread_id: Uuid,
        uids: &[String],
    ) -> impl Future<Output = Result<Vec<(Uuid, CalendarInvitation)>, Report>> + Send;
}
fn revision(link_id: Uuid, invite: &CalendarInvitation) -> InvitationRevision {
    InvitationRevision {
        link_id,
        sequence: invite.sequence,
        last_modified: stamp(invite),
        cancelled: cancelled(invite),
    }
}
fn occurrence_key(value: Option<&InvitationDateTime>) -> Option<String> {
    match value {
        Some(InvitationDateTime::Date { value } | InvitationDateTime::Zoned { value, .. }) => {
            Some(value.clone())
        }
        _ => None,
    }
}
fn same_occurrence(a: &CalendarInvitation, b: &CalendarInvitation) -> bool {
    match (
        occurrence_key(a.recurrence_id.as_ref()),
        occurrence_key(b.recurrence_id.as_ref()),
    ) {
        (Some(a), Some(b)) => a == b,
        (None, None) if a.recurrence_id.is_some() && b.recurrence_id.is_some() => {
            a.recurrence_id == b.recurrence_id
        }
        (None, None) => a.recurrence_id_raw == b.recurrence_id_raw,
        _ => false,
    }
}
fn matching_series(candidate: &CalendarInvitation, invite: &CalendarInvitation) -> bool {
    candidate.uid == invite.uid
        && matches!(
            candidate.method,
            InvitationMethod::Request | InvitationMethod::Cancel
        )
        && candidate
            .organizer
            .as_ref()
            .zip(invite.organizer.as_ref())
            .is_some_and(|(a, b)| a.email.eq_ignore_ascii_case(&b.email))
}
fn applicable_revision(candidate: &CalendarInvitation, invite: &CalendarInvitation) -> bool {
    matching_series(candidate, invite) && same_occurrence(candidate, invite)
}

fn stamp(invite: &CalendarInvitation) -> Option<chrono::DateTime<chrono::Utc>> {
    invite
        .last_modified
        .as_ref()
        .or(invite.dtstamp.as_ref())
        .and_then(|value| chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ").ok())
        .map(|date| date.and_utc())
}
fn invitation_identity(
    message_id: Uuid,
    link_id: Uuid,
    invite: &CalendarInvitation,
    revisions: &[(Uuid, CalendarInvitation)],
) -> InvitationIdentity {
    let latest = revisions
        .iter()
        .filter(|(link, candidate)| *link == link_id && applicable_revision(candidate, invite))
        .map(|(_, candidate)| candidate)
        .chain(std::iter::once(invite))
        .max_by_key(|candidate| revision(link_id, candidate).ordering_key())
        .unwrap_or(invite);
    let key = occurrence_key(invite.recurrence_id.as_ref());
    let to_revision = |(link, candidate): &(Uuid, CalendarInvitation)| revision(*link, candidate);
    InvitationIdentity {
        id: format!("{message_id}:{}", invite.id),
        uid: invite.uid.clone(),
        preferred_link_id: link_id,
        unresolved_instance: invite.recurrence_id_raw.is_some() && key.is_none(),
        occurrence_key: key,
        cancelled: cancelled(latest),
        related_revisions: revisions
            .iter()
            .filter(|(link, candidate)| *link != link_id && applicable_revision(candidate, invite))
            .map(to_revision)
            .collect(),
        // A master's SEQUENCE is independent of each exception's SEQUENCE.
        // Retain requests too: a newer master request can supersede an old cancellation.
        series_revisions: revisions
            .iter()
            .filter(|(_, candidate)| {
                invite.recurrence_id_raw.is_some()
                    && candidate.recurrence_id_raw.is_none()
                    && candidate.recurrence_id.is_none()
                    && matching_series(candidate, invite)
            })
            .map(to_revision)
            .collect(),
        organizer_email: invite
            .organizer
            .as_ref()
            .map(|organizer| organizer.email.clone()),
        sequence: latest.sequence,
        last_modified: stamp(latest),
    }
}

fn cancelled(invite: &CalendarInvitation) -> bool {
    invite.method == InvitationMethod::Cancel
        || invite
            .status
            .as_deref()
            .is_some_and(|status| status.eq_ignore_ascii_case("CANCELLED"))
}

/// Resolve the newest saved components of one authorized thread in one calendar batch.
/// Caller-supplied UIDs are never used.
pub async fn resolve<C: CalendarInvitationService, S: InvitationSnapshotRepository>(
    calendar: &C,
    snapshots: &S,
    receipt: EntityAccessReceipt<ViewAccessLevel>,
) -> Result<HashMap<String, InvitationResolution>, Report> {
    let started = std::time::Instant::now();
    let viewer = receipt
        .get_authenticated_user()
        .map_err(|_| rootcause::report!("authentication required"))?
        .to_string();
    let thread_id = Uuid::parse_str(&receipt.entity().entity_id)
        .map_err(|error| rootcause::report!("invalid thread id: {error}"))?;
    let saved = snapshots
        .thread_invitations(thread_id, MAX_INVITATION_BATCH as i64)
        .await?;
    let uids = saved
        .iter()
        .map(|saved| saved.invitation.uid.clone())
        .collect::<Vec<_>>();
    let revisions = snapshots.revisions(&viewer, thread_id, &uids).await?;
    let identities = saved
        .iter()
        .map(|saved| {
            invitation_identity(
                saved.message_id,
                saved.link_id,
                &saved.invitation,
                &revisions,
            )
        })
        .collect::<Vec<_>>();
    let resolved = calendar.resolve(&viewer, &identities).await?;
    let mut reasons = HashMap::<&str, usize>::new();
    let result = identities
        .into_iter()
        .zip(resolved)
        .map(|(identity, resolution)| {
            let reason = match &resolution {
                InvitationResolution::Resolved { is_stale: true, .. } => "stale",
                InvitationResolution::Resolved { .. } => "resolved",
                InvitationResolution::StillSyncing => "still_syncing",
                InvitationResolution::Disconnected => "disconnected",
                InvitationResolution::Cancelled => "cancelled",
                InvitationResolution::Unavailable => "unavailable",
                InvitationResolution::NoMatch => "no_match",
                InvitationResolution::Ambiguous => "ambiguous",
            };
            *reasons.entry(reason).or_default() += 1;
            (identity.id, resolution)
        })
        .collect::<HashMap<_, _>>();
    tracing::info!(
        count = result.len(),
        elapsed_ms = started.elapsed().as_millis(),
        ?reasons,
        "calendar invitations resolved"
    );
    Ok(result)
}

#[cfg(all(test, feature = "calendar_parser"))]
mod test;
