//! The one-time notice a team admin sends after creating a team for their work domain.
//!
//! It goes to the admin's contacts on that domain who are not on Macro yet. The join
//! announcement claim decides who is eligible and caps each team at
//! [`MAX_RECIPIENTS_PER_TEAM`](super::join_announcement::MAX_RECIPIENTS_PER_TEAM).

#[cfg(test)]
mod test;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use rootcause::{Report, prelude::*};

use super::join_announcement::{AnnounceJoin, AnnounceReport, JoinAnnouncementService};

/// Errors from sending a team's domain notice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DomainNoticeError {
    /// The receipt does not name a team and a user.
    #[error("the request does not name a team and a user")]
    InvalidReceipt,
    /// Reading contacts or claiming recipients failed.
    #[error("sending the domain notice failed")]
    Storage,
}

/// The people a user has corresponded with.
pub trait ColleagueDirectory: Send + Sync + 'static {
    /// The user's contacts, in no particular order.
    fn contacts(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;
}

/// Sends a team's domain notice.
pub trait DomainNoticeService: Send + Sync + 'static {
    /// Emails the admin's same-domain contacts that the team exists. Contacts already on Macro,
    /// on the team, invited, or emailed before are skipped.
    fn send_domain_notice(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> impl Future<Output = Result<AnnounceReport, Report<DomainNoticeError>>> + Send;
}

/// The [`DomainNoticeService`] over a contacts directory and the join announcer.
pub struct DomainNoticeServiceImpl<D, J> {
    directory: D,
    announcer: J,
}

impl<D, J> DomainNoticeServiceImpl<D, J> {
    /// Creates the service.
    pub fn new(directory: D, announcer: J) -> Self {
        Self {
            directory,
            announcer,
        }
    }
}

impl<D, J> DomainNoticeService for DomainNoticeServiceImpl<D, J>
where
    D: ColleagueDirectory,
    J: JoinAnnouncementService,
{
    #[tracing::instrument(
        name = "teams.domain_notice",
        skip_all,
        fields(team_id, candidates, claimed, sent),
        err
    )]
    async fn send_domain_notice(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<AnnounceReport, Report<DomainNoticeError>> {
        let team_id = macro_uuid::string_to_uuid(&receipt.entity().entity_id)
            .map_err(|_| Report::new(DomainNoticeError::InvalidReceipt))?;
        let sender = receipt
            .acting_user_id()
            .cloned()
            .ok_or_else(|| Report::new(DomainNoticeError::InvalidReceipt))?;
        let span = tracing::Span::current();
        span.record("team_id", tracing::field::display(team_id));

        let sender_email = sender.email_part().lowercase();
        let domain = sender_email.domain_part();
        let candidates: Vec<_> = self
            .directory
            .contacts(&sender)
            .await
            .context(DomainNoticeError::Storage)?
            .into_iter()
            .filter(|contact| {
                contact
                    .email_part()
                    .domain_part()
                    .eq_ignore_ascii_case(domain)
            })
            .collect();
        span.record("candidates", candidates.len());

        let report = self
            .announcer
            .announce_join(AnnounceJoin {
                team_id,
                joined: sender,
                joined_name: None,
                candidates,
            })
            .await
            .context(DomainNoticeError::Storage)?;
        span.record("claimed", report.claimed);
        span.record("sent", report.sent);
        Ok(report)
    }
}
