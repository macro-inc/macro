//! Translation to the import domain's canonical ledger port. No concrete
//! repository construction or cross-domain outbound imports belong here.

use import::domain::{models as ledger, ports::CanonicalImportRepo};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::{
    models::*,
    ports::{ImportLedger, PortResult},
};

#[cfg(test)]
mod test;

/// Archive adapter over the owning import domain's narrow canonical port.
#[derive(Clone)]
pub struct CanonicalImportLedger<R> {
    repo: R,
}

impl<R> CanonicalImportLedger<R> {
    /// Wrap a canonical port supplied by the composition root.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: CanonicalImportRepo> ImportLedger for CanonicalImportLedger<R> {
    async fn source_binding(&self, team: TeamId) -> PortResult<SourceBinding> {
        match self
            .repo
            .source_binding(team.into())
            .await
            .map_err(map_error)?
        {
            None => Ok(SourceBinding::Unbound),
            Some(binding) => match binding.workspace_id {
                Some(id) => Ok(SourceBinding::Known {
                    source_id: id.as_str().parse().map_err(|_| ImportError::Internal)?,
                }),
                None => Ok(SourceBinding::ConfirmedUnknown),
            },
        }
    }

    async fn reserve(
        &self,
        team: TeamId,
        requester: &MacroUserIdStr<'static>,
        metadata: &ConversationMetadata,
        authorized_existing_target: Option<Uuid>,
    ) -> PortResult<TargetReservation> {
        let key = target_key(team, &metadata.slack_channel_id)?;
        let reservation = self
            .repo
            .reserve_target(
                requester,
                &key,
                target_kind(metadata.kind),
                authorized_existing_target,
            )
            .await
            .map_err(map_error)?;
        Ok(TargetReservation {
            team_id: team,
            slack_channel_id: metadata.slack_channel_id.clone(),
            channel_id: reservation.channel_id,
            status: if reservation.ready {
                ReservationStatus::Ready
            } else {
                ReservationStatus::Pending
            },
        })
    }

    async fn complete(
        &self,
        reservation: &TargetReservation,
        kind: ConversationKind,
    ) -> PortResult<()> {
        self.repo
            .complete_target(
                &target_key(reservation.team_id, &reservation.slack_channel_id)?,
                reservation.channel_id,
                target_kind(kind),
            )
            .await
            .map_err(map_error)?;
        Ok(())
    }
}

fn target_key(team: TeamId, conversation: &ConversationId) -> PortResult<ledger::ImportTargetKey> {
    Ok(ledger::ImportTargetKey {
        team_id: team.into(),
        foreign_id: ledger::SlackConversationId::new(conversation.as_str())
            .ok_or(ImportError::InvalidInput)?,
    })
}

fn target_kind(kind: ConversationKind) -> ledger::ImportTargetKind {
    match kind {
        ConversationKind::PublicChannel => ledger::ImportTargetKind::Team,
        ConversationKind::PrivateChannel | ConversationKind::GroupDirectMessage => {
            ledger::ImportTargetKind::Private
        }
        ConversationKind::DirectMessage => ledger::ImportTargetKind::DirectMessage,
    }
}

fn map_error(error: import::domain::ports::ImportError) -> rootcause::Report<ImportError> {
    use import::domain::ports::ImportError as LedgerError;
    let code = match &error {
        LedgerError::SourceMismatch => ImportError::SourceMismatch,
        LedgerError::SourceConfirmationRequired => ImportError::InvalidInput,
        LedgerError::TargetConflict | LedgerError::TargetNotReserved => ImportError::Conflict,
        LedgerError::Db(_) | LedgerError::Other(_) => ImportError::Retryable,
        // Canonical ledger operations do not perform AI work. An admission
        // error here is an unexpected adapter failure, not permission to proceed.
        LedgerError::Admission(_) | LedgerError::Metadata(_) => ImportError::Internal,
    };
    rootcause::Report::new(error).context(code)
}
