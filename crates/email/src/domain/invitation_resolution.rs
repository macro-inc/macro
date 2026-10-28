//! Derive calendar identities from an authorized thread's saved snapshots.
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
}
fn revision(invite: &CalendarInvitation) -> InvitationRevision {
    InvitationRevision {
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
fn newest<'a>(
    candidates: impl Iterator<Item = &'a CalendarInvitation>,
) -> Option<InvitationRevision> {
    candidates
        .map(revision)
        .max_by_key(InvitationRevision::ordering_key)
}
/// Revisions come only from the same thread, which belongs to one inbox.
fn invitation_identity(
    saved: &ThreadInvitation,
    thread: &[ThreadInvitation],
) -> InvitationIdentity {
    let invite = &saved.invitation;
    let thread = thread.iter().map(|saved| &saved.invitation);
    let key = occurrence_key(invite.recurrence_id.as_ref());
    InvitationIdentity {
        uid: invite.uid.clone(),
        preferred_link_id: saved.link_id,
        unresolved_instance: invite.recurrence_id_raw.is_some() && key.is_none(),
        occurrence_key: key,
        revision: newest(
            thread
                .clone()
                .filter(|candidate| applicable_revision(candidate, invite))
                .chain(std::iter::once(invite)),
        )
        .expect("includes the invitation itself"),
        // A master's SEQUENCE is independent of each exception's SEQUENCE.
        // Keep requests too: a newer master request can supersede an old cancellation.
        series_revision: invite
            .recurrence_id_raw
            .is_some()
            .then(|| {
                newest(thread.filter(|candidate| {
                    candidate.recurrence_id_raw.is_none() && matching_series(candidate, invite)
                }))
            })
            .flatten(),
        organizer_email: invite
            .organizer
            .as_ref()
            .map(|organizer| organizer.email.clone()),
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
    let viewer = receipt
        .get_authenticated_user()
        .map_err(|_| rootcause::report!("authentication required"))?
        .to_string();
    let thread_id = Uuid::parse_str(&receipt.entity().entity_id)
        .map_err(|error| rootcause::report!("invalid thread id: {error}"))?;
    let saved = snapshots
        .thread_invitations(thread_id, MAX_INVITATION_BATCH as i64)
        .await?;
    let identities = saved
        .iter()
        .map(|invitation| invitation_identity(invitation, &saved))
        .collect::<Vec<_>>();
    let resolved = calendar.resolve(&viewer, &identities).await?;
    tracing::info!(count = resolved.len(), "calendar invitations resolved");
    Ok(saved
        .iter()
        .zip(resolved)
        .map(|(saved, resolution)| {
            (
                format!("{}:{}", saved.message_id, saved.invitation.id),
                resolution,
            )
        })
        .collect())
}

#[cfg(test)]
mod test;
