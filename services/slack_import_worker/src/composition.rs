//! Cross-domain transaction coordination belongs here, never in another domain's adapter.

pub mod authorizer;
pub mod channel_sink;
pub mod join_announcer;
pub mod reference_reconciliation;
pub mod references;

#[cfg(test)]
mod test;

use import::domain::models::{ImportTargetKey, ImportTargetKind, SlackConversationId};
use slack_integration::domain::{models::*, ports::PortResult};

fn target_key(team: TeamId, source: &ConversationId) -> PortResult<ImportTargetKey> {
    Ok(ImportTargetKey {
        team_id: team.into(),
        foreign_id: SlackConversationId::new(source.as_str()).ok_or(ImportError::InvalidInput)?,
    })
}

fn target_kind(kind: ConversationKind) -> ImportTargetKind {
    match kind {
        ConversationKind::PublicChannel => ImportTargetKind::Team,
        ConversationKind::PrivateChannel | ConversationKind::GroupDirectMessage => {
            ImportTargetKind::Private
        }
        ConversationKind::DirectMessage => ImportTargetKind::DirectMessage,
    }
}

fn retry(
    error: impl std::fmt::Display + std::fmt::Debug + Send + Sync + 'static,
) -> rootcause::Report<ImportError> {
    rootcause::Report::new_custom::<rootcause::handlers::Display>(error)
        .context(ImportError::Retryable)
}

fn ledger_error(error: import::domain::ports::ImportError) -> rootcause::Report<ImportError> {
    use import::domain::ports::ImportError as E;
    match error {
        E::TargetConflict | E::TargetNotReserved => ImportError::Unavailable.into(),
        other => retry(other),
    }
}
