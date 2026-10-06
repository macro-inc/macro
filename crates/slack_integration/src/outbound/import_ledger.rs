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

impl<R: CanonicalImportRepo + import::domain::ports::ImportTargetReader> CanonicalImportLedger<R> {
    /// Read exact targets without reservation, while fencing against a changed
    /// binding. Returned labels are internal facts until domain disclosure checks.
    pub async fn reference_channels(
        &self,
        team: TeamId,
        expected: &SourceBinding,
        channels: &[ConversationId],
    ) -> PortResult<Vec<crate::domain::slack::references::resolve::ChannelMapping>> {
        use crate::domain::slack::references::resolve::ChannelMapping;
        let Some(binding) = self
            .repo
            .source_binding(team.into())
            .await
            .map_err(map_error)?
        else {
            return Ok(vec![ChannelMapping::Missing; channels.len()]);
        };
        let compatible = match (expected, binding.workspace_id.as_ref()) {
            (SourceBinding::Known { source_id }, Some(bound)) => {
                source_id.as_str() == bound.as_str()
            }
            (SourceBinding::ConfirmedUnknown, None) => binding.confirmed_unknown_at.is_some(),
            _ => false,
        };
        if !compatible {
            return Ok(vec![ChannelMapping::Missing; channels.len()]);
        }
        let ids = channels
            .iter()
            .map(|id| {
                ledger::SlackConversationId::new(id.as_str()).ok_or(ImportError::InvalidInput)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(self
            .repo
            .lookup_targets(team.into(), &binding, &ids)
            .await
            .map_err(map_error)?
            .into_iter()
            .map(|row| match row {
                ledger::ImportTargetLookup::Missing => ChannelMapping::Missing,
                ledger::ImportTargetLookup::Pending => ChannelMapping::Pending,
                ledger::ImportTargetLookup::Ready {
                    channel_id,
                    kind,
                    name,
                } => ChannelMapping::Ready {
                    id: channel_id,
                    name,
                    team_visible: kind == ledger::ImportTargetKind::Team,
                },
            })
            .collect())
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
        // Canonical ledger operations do not perform discovery or AI work.
        // These errors are unexpected adapter failures, not permission to proceed.
        LedgerError::Admission(_)
        | LedgerError::Metadata(_)
        | LedgerError::UnsupportedDiscovery(_) => ImportError::Internal,
    };
    rootcause::Report::new(error).context(code)
}
