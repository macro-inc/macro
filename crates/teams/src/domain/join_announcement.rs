//! "x joined Macro" emails to colleagues who share a team's auto-join domain.
//!
//! Each address is claimed once per team, forever, before its email is enqueued. The claim
//! decides eligibility. This module only shapes and sends the emails it accepted.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::{cowlike::CowLike, email::EmailStr, user_id::MacroUserIdStr};
use model_entity::EntityType;
use model_notifications::ColleagueJoinedMacro;
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use rootcause::Report;
use uuid::Uuid;

const MAX_UNSENT_CLAIMS_PER_CRASH: usize = 50;

const NOTIFICATION_ID_NAMESPACE: Uuid = Uuid::from_u128(0x7465_616d_2d6a_6f69_6e65_642d_6d61_6372);

/// A user who joined a team, and the colleagues who might hear about it.
#[derive(Debug, Clone)]
pub struct AnnounceJoin {
    /// The team the user joined.
    pub team_id: Uuid,
    /// The user who joined.
    pub joined: MacroUserIdStr<'static>,
    /// The joined user's display name from an untrusted source.
    pub joined_name: Option<String>,
    /// Possible recipients. They may include `joined` and duplicates.
    pub candidates: Vec<MacroUserIdStr<'static>>,
}

/// Counts from one announcement. It never carries addresses.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct AnnounceReport {
    /// Addresses claimed for an email.
    pub claimed: u32,
    /// Emails enqueued.
    pub sent: u32,
    /// Claims released because their email could not be enqueued.
    pub released: u32,
}

/// Errors from announcing a join.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum JoinAnnouncementError {
    /// Reading or writing the claims failed.
    #[error("join announcement storage failed")]
    Storage,
}

/// A recipient that the claim accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedJoinEmail {
    /// The colleague to email.
    pub recipient: MacroUserIdStr<'static>,
    /// The name of the team.
    pub team_name: String,
}

/// Storage for the once-per-address claims.
pub trait JoinAnnouncementRepository: Send + Sync + 'static {
    /// Claims every candidate who matches the team's auto-join domain, is neither a member nor
    /// invited, and was never claimed for this team. It is one statement, so concurrent claims
    /// of an address have exactly one winner. Returns nothing when the team has no auto-join
    /// domain.
    fn claim(
        &self,
        team_id: Uuid,
        candidates: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<Vec<ClaimedJoinEmail>, Report<JoinAnnouncementError>>> + Send;

    /// Undoes one claim whose email was not enqueued, so a later announcement can retry it.
    fn release(
        &self,
        team_id: Uuid,
        recipient: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Report<JoinAnnouncementError>>> + Send;
}

/// Tells colleagues that someone joined Macro.
pub trait JoinAnnouncementService: Send + Sync + 'static {
    /// Emails each candidate other than `joined` whom
    /// [`JoinAnnouncementRepository::claim`] accepts. Every address is claimed before its
    /// email is enqueued.
    fn announce_join(
        &self,
        request: AnnounceJoin,
    ) -> impl Future<Output = Result<AnnounceReport, Report<JoinAnnouncementError>>> + Send;
}

/// The [`JoinAnnouncementService`] over a claim repository and the notification ingress.
#[derive(Clone)]
pub struct JoinAnnouncementServiceImpl<R, N> {
    repository: R,
    ingress: N,
}

impl<R, N> JoinAnnouncementServiceImpl<R, N> {
    /// Creates the service.
    pub fn new(repository: R, ingress: N) -> Self {
        Self {
            repository,
            ingress,
        }
    }
}

fn idempotent_notification_id(team_id: Uuid, recipient: &MacroUserIdStr<'_>) -> Uuid {
    Uuid::new_v5(
        &NOTIFICATION_ID_NAMESPACE,
        format!("{team_id}:{}", recipient.email_str()).as_bytes(),
    )
}

impl<R, N> JoinAnnouncementService for JoinAnnouncementServiceImpl<R, N>
where
    R: JoinAnnouncementRepository,
    N: NotificationIngress,
{
    #[tracing::instrument(skip_all, fields(team_id = %request.team_id), err)]
    async fn announce_join(
        &self,
        request: AnnounceJoin,
    ) -> Result<AnnounceReport, Report<JoinAnnouncementError>> {
        let AnnounceJoin {
            team_id,
            joined,
            joined_name,
            mut candidates,
        } = request;
        candidates.retain(|candidate| *candidate != joined);
        candidates.sort_by(|a, b| a.email_str().cmp(b.email_str()));
        candidates.dedup();

        let mut report = AnnounceReport::default();
        for chunk in candidates.chunks(MAX_UNSENT_CLAIMS_PER_CRASH) {
            for ClaimedJoinEmail {
                recipient,
                team_name,
            } in self.repository.claim(team_id, chunk).await?
            {
                report.claimed += 1;
                let request = SendNotificationRequestBuilder {
                    notification_entity: EntityType::Team.with_entity_string(team_id.to_string()),
                    secondary_notification_entity: None,
                    sender_id: Some(joined.clone()),
                    recipient_ids: HashSet::from([recipient.clone()]),
                    notification: ColleagueJoinedMacro {
                        team_name,
                        joined_by: joined.clone(),
                        joined_name: joined_name.clone(),
                        recipient_email: EmailStr(recipient.email_part()).into_owned(),
                    },
                }
                .into_request_with_id(idempotent_notification_id(team_id, &recipient))
                .with_email();
                match self.ingress.send_notification(request).await {
                    Ok(_) => report.sent += 1,
                    Err(error) => {
                        tracing::warn!(
                            %team_id,
                            error = ?error,
                            "join email enqueue failed; releasing the claim"
                        );
                        if self.repository.release(team_id, &recipient).await.is_ok() {
                            report.released += 1;
                        }
                    }
                }
            }
        }
        Ok(report)
    }
}
