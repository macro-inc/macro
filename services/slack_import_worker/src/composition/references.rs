//! Read-only cross-domain reference wiring. No channel reservation, row locks,
//! membership changes, Slack calls, or body writes occur in this composition.

use std::collections::HashMap;

use entity_access::{domain::ports::AccessRepository, outbound::PgAccessRepository};
use import::outbound::pg_import_repo::PgImportRepo;
use messages::{
    domain::ports::HistoricalMessageReader, outbound::pg_message_repo::PgMessageRepository,
};
use slack_integration::{
    domain::{
        models::*,
        ports::{ImportLedger, PortResult, ReferenceLookup, SourceMessageReader},
        slack::references::resolve::*,
    },
    outbound::{import_ledger::CanonicalImportLedger, pg_slack_import_repo::PgSlackImportRepo},
};
use sqlx::PgPool;
use uuid::Uuid;

use super::retry;

/// Concrete read-only capabilities, also usable by deferred job reconciliation.
pub struct WorkerReferenceLookup {
    ledger: CanonicalImportLedger<PgImportRepo>,
    imports: PgSlackImportRepo,
    messages: PgMessageRepository,
    access: PgAccessRepository,
}

impl WorkerReferenceLookup {
    /// Construct only at the application composition boundary.
    pub fn new(pool: PgPool, limits: ImportLimits) -> Self {
        Self {
            ledger: CanonicalImportLedger::new(PgImportRepo::new(pool.clone())),
            imports: PgSlackImportRepo::new(pool.clone(), limits),
            messages: PgMessageRepository::new(pool.clone()),
            access: PgAccessRepository::new(pool),
        }
    }

    /// Build trusted context from an explicit team-owned job. No v1 persistence
    /// establishes workspace domains, so permalink domain evidence stays empty.
    pub async fn context(&self, team: TeamId, job: JobId) -> PortResult<Option<ReferenceContext>> {
        let Some((requester, source)) = self.imports.reference_job(team, job).await? else {
            return Ok(None);
        };
        Ok(Some(ReferenceContext {
            team,
            job,
            requester,
            source,
            binding: self.ledger.source_binding(team).await?,
            domains: vec![],
        }))
    }
}

impl ReferenceLookup for WorkerReferenceLookup {
    async fn channels(
        &self,
        context: &ReferenceContext,
        channels: &[ConversationId],
    ) -> PortResult<Vec<ChannelMapping>> {
        self.ledger
            .reference_channels(context.team, &context.binding, channels)
            .await
    }

    async fn pending_channels(
        &self,
        context: &ReferenceContext,
        channels: &[ConversationId],
    ) -> PortResult<Vec<ConversationId>> {
        self.imports
            .pending_reference_channels(context.team, context.job, channels)
            .await
    }

    async fn messages(
        &self,
        context: &ReferenceContext,
        sources: &[SourceMessageId],
    ) -> PortResult<Vec<MessageMapping>> {
        let mappings = self
            .imports
            .reference_mappings(context.team, sources)
            .await?;
        let ids: Vec<_> = mappings
            .iter()
            .map(|m| m.message)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        let actual: HashMap<_, _> = self
            .messages
            .lookup_historical_targets(&ids)
            .await
            .map_err(retry)?
            .into_iter()
            .map(|message| (message.message_id, message))
            .collect();
        let mappings: HashMap<_, _> = mappings
            .into_iter()
            .map(|mapping| (mapping.source.clone(), mapping))
            .collect();
        Ok(sources
            .iter()
            .map(|source| {
                let Some(mapping) = mappings.get(source) else {
                    return MessageMapping::Missing;
                };
                match actual.get(&mapping.message) {
                    Some(message) if message.channel_id == mapping.channel => {
                        MessageMapping::Ready {
                            channel: mapping.channel,
                            message: message.message_id,
                            root: message.root_id,
                        }
                    }
                    _ => MessageMapping::Invalid,
                }
            })
            .collect())
    }

    async fn disclosure_access(
        &self,
        context: &ReferenceContext,
        channels: &[Uuid],
    ) -> PortResult<DisclosureAccess> {
        if channels.len() > ImportLimits::default().database_batch_messages as usize {
            return Err(ImportError::LimitExceeded.into());
        }
        let team = self
            .access
            .get_user_team(&context.requester.0)
            .await
            .map_err(retry)?;
        let participants = self
            .access
            .check_user_channel_membership(Some(&context.requester.0), channels)
            .await
            .map_err(retry)?;
        Ok(DisclosureAccess {
            team_member: team.is_some_and(|team| team.team_id == Uuid::from(context.team)),
            participant_channels: participants.into_iter().collect(),
        })
    }
}
