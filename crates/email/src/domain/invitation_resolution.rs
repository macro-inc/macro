//! Authorize email reads before deriving calendar identities from saved snapshots.
use super::{
    models::calendar_invitation::{CalendarInvitation, InvitationDateTime, InvitationMethod},
    ports::EmailService,
};
use calendar_events::domain::invitations::{
    CalendarInvitationRepository, CalendarInvitationResolver, InvitationIdentity,
    InvitationResolution, InvitationRevision,
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use rootcause::Report;
use std::{collections::HashMap, future::Future};
use uuid::Uuid;

/// Email-owned access-aware lookup of newer scheduling messages.
pub trait InvitationRevisionRepository: Send + Sync {
    /// Only the authorized thread and independently owned inboxes may contribute.
    fn revisions(
        &self,
        viewer: &str,
        thread_id: Uuid,
        uids: &[String],
    ) -> impl Future<Output = Result<Vec<(Uuid, CalendarInvitation)>, Report>> + Send;
}
fn revision(invite: &CalendarInvitation) -> (u32, &str, bool) {
    (
        invite.sequence,
        invite
            .last_modified
            .as_deref()
            .or(invite.dtstamp.as_deref())
            .unwrap_or(""),
        invite.method == InvitationMethod::Cancel,
    )
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
        .max_by_key(|candidate| revision(candidate))
        .unwrap_or(invite);
    let key = occurrence_key(invite.recurrence_id.as_ref());
    let to_revision = |(link, candidate): &(Uuid, CalendarInvitation)| InvitationRevision {
        link_id: *link,
        sequence: candidate.sequence,
        last_modified: stamp(candidate),
        cancelled: cancelled(candidate),
    };
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

/// Batch resolution for one authorized thread page. Caller-supplied UIDs are never used.
pub async fn resolve<
    E: EmailService,
    R: CalendarInvitationRepository,
    S: InvitationRevisionRepository,
>(
    email: &E,
    calendar: &CalendarInvitationResolver<R>,
    snapshots: &S,
    receipt: EntityAccessReceipt<ViewAccessLevel>,
    offset: i64,
    limit: i64,
    actions_enabled: bool,
) -> Result<HashMap<String, InvitationResolution>, Report> {
    let started = std::time::Instant::now();
    if offset < 0 || !(1..=100).contains(&limit) {
        return Err(rootcause::report!("invalid invitation page"));
    }
    let viewer = receipt
        .get_authenticated_user()
        .map_err(|_| rootcause::report!("authentication required"))?
        .to_string();
    let thread = email
        .get_thread_with_messages(receipt, offset, limit)
        .await
        .map_err(|e| rootcause::report!(e.to_string()))?
        .ok_or_else(|| rootcause::report!("thread not found"))?;
    let uids = thread
        .messages
        .iter()
        .flat_map(|m| {
            m.calendar_invitations
                .invitations
                .iter()
                .map(|i| i.uid.clone())
        })
        .collect::<Vec<_>>();
    let revisions = snapshots
        .revisions(&viewer, thread.row.db_id, &uids)
        .await?;
    let identities = thread
        .messages
        .iter()
        .flat_map(|message| {
            message
                .calendar_invitations
                .invitations
                .iter()
                .map(|invite| {
                    invitation_identity(message.db_id, message.link_id, invite, &revisions)
                })
        })
        .collect::<Vec<_>>();
    let mut result = HashMap::new();
    let mut reasons = HashMap::<&str, usize>::new();
    for batch in identities.chunks(100) {
        let resolved = calendar.resolve(&viewer, batch).await?;
        for (identity, mut resolution) in batch.iter().zip(resolved) {
            if let InvitationResolution::Resolved { can_respond, .. } = &mut resolution {
                *can_respond &= actions_enabled;
            }
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
            result.insert(identity.id.clone(), resolution);
        }
    }
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
