//! Conversation orchestration. No live-message path, transport, SQL or roster
//! lookup is involved. The driver owns independent lease/visibility heartbeats;
//! every persistence port must fence writes even while this future is blocked.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{
    models::*,
    ports::*,
    slack::{
        export::{NormalizedMessage, NormalizedRecord},
        mrkdwn::{MessageConversion, MrkdwnConverter},
        reactions,
        users::{ResolvedAuthor, UserDirectory},
    },
};

mod stream;
pub mod targets;

use targets::{ImportTargets, TargetFacts, TargetKind, TargetPlan};

impl<R, S, L, T, H, A> ImportWorker for ConversationImporter<R, S, L, T, H, A>
where
    R: ExecutionRepo,
    S: ImportStorage,
    L: ImportLedger,
    T: ImportTargets,
    H: HistoricalSink,
    A: ImportAuthorizer,
{
    async fn claim(&self, event: &ImportEvent, owner: WorkerId) -> PortResult<ClaimOutcome> {
        self.claim(event, owner).await
    }

    async fn import(&self, context: &ClaimedConversation) -> PortResult<WorkerOutcome> {
        self.import(context).await
    }

    async fn heartbeat(&self, lease: &Lease) -> PortResult<Lease> {
        self.repo.heartbeat(lease).await
    }
}

#[cfg(test)]
mod test;

/// Importer configuration supplied by the composition root, not the archive.
pub struct ImporterConfig {
    /// Effective worker/server bounds.
    pub limits: ImportLimits,
}

/// Domain workflow over persistence, storage, ledger, target and authorization ports.
pub struct ConversationImporter<R, S, L, T, H, A> {
    repo: R,
    storage: S,
    ledger: L,
    targets: T,
    sink: H,
    authorizer: A,
    limits: ImportLimits,
}

impl<R, S, L, T, H, A> ConversationImporter<R, S, L, T, H, A> {
    /// Construct with validated bounds; no environment access in the domain.
    pub fn new(
        repo: R,
        storage: S,
        ledger: L,
        targets: T,
        sink: H,
        authorizer: A,
        config: ImporterConfig,
    ) -> Result<Self, ImportError> {
        let ImporterConfig { limits } = config;
        if limits.database_batch_messages == 0
            || limits.database_batch_messages > ImportLimits::default().database_batch_messages
            || limits.database_batch_bytes == 0
            || limits.record_bytes == 0
            || limits.part_bytes < limits.record_bytes
            || limits.part_records == 0
            || limits.json_bytes == 0
            || limits.selected_bytes < limits.part_bytes.max(limits.json_bytes)
        {
            return Err(ImportError::InvalidInput);
        }
        Ok(Self {
            repo,
            storage,
            ledger,
            targets,
            sink,
            authorizer,
            limits,
        })
    }
}

impl<R, S, L, T, H, A> ConversationImporter<R, S, L, T, H, A>
where
    R: ExecutionRepo,
    S: ImportStorage,
    L: ImportLedger,
    T: ImportTargets,
    H: HistoricalSink,
    A: ImportAuthorizer,
{
    /// Revalidate the durable requester BEFORE claiming/reclaiming. An unauthorized
    /// request cannot acquire a lease; the driver reconciles exhausted deliveries.
    /// Separating claim lets the driver start heartbeats before reading any objects.
    pub async fn claim(&self, event: &ImportEvent, owner: WorkerId) -> PortResult<ClaimOutcome> {
        let Some((team, requester)) = self.repo.requester(event).await? else {
            return Ok(ClaimOutcome::Obsolete);
        };
        self.authorizer.require_admin(team, &requester).await?;
        self.repo.claim(event, owner).await
    }

    /// Import one claimed conversation and durably settle success or permanent
    /// rejection. Transient errors and lost leases are returned for driver recovery;
    /// already committed history/search work is never rolled back or recounted.
    pub async fn import(&self, context: &ClaimedConversation) -> PortResult<WorkerOutcome> {
        let result = self.run(context).await;
        let (status, error) = match result {
            Ok(status) => (status, None),
            Err(error) => {
                let code = *error.current_context();
                match code {
                    ImportError::Retryable | ImportError::LeaseLost | ImportError::Internal => {
                        return Err(error);
                    }
                    ImportError::Unavailable | ImportError::Conflict => {
                        // Receipts redact even a previously bound target on reclaim;
                        // keep its internal identity for partial-history search work.
                        self.targets
                            .warn(&context.lease, ImportWarning::TargetUnavailable)
                            .await?;
                        (ConversationStatus::Skipped, Some(ImportError::Unavailable))
                    }
                    _ => (ConversationStatus::Failed, Some(code)),
                }
            }
        };
        self.repo.settle(&context.lease, status, error).await?;
        Ok(WorkerOutcome::Acknowledge)
    }

    async fn run(&self, context: &ClaimedConversation) -> PortResult<ConversationStatus> {
        self.authorizer
            .require_admin(context.team_id, &context.requested_by)
            .await?;
        if context.lease.event.slack_channel_id != context.metadata.slack_channel_id {
            return Err(ImportError::InvalidInput.into());
        }
        let users = stream::users(&self.storage, &context.users, &self.limits).await?;
        let mut reader = stream::ArchiveReader::new(&self.storage, context, self.limits)?;
        // Reading from the beginning also makes missing-time fallback stable on retry.
        let first = reader.next().await?;
        let Some(plan) = self
            .resolve_target(context, &users, first.as_ref().map(|record| record.ts))
            .await?
        else {
            return Ok(ConversationStatus::Skipped);
        };
        let channels =
            BTreeMap::from([(context.metadata.slack_channel_id.clone(), plan.name.clone())]);
        let converter = MrkdwnConverter {
            users: &users,
            channels: &channels,
        };
        let mut batch = PendingBatch::new(context);
        let mut record = first;
        while let Some(current) = record {
            if !current.committed {
                let message = match current.normalized {
                    NormalizedRecord::Message(message) => self.convert(
                        *message,
                        current.order,
                        plan.channel_id,
                        context.team_id,
                        &users,
                        &converter,
                    ),
                    NormalizedRecord::Skipped(_) => None,
                };
                let bytes = message
                    .as_ref()
                    .map(historical_message_bytes)
                    .transpose()?
                    .unwrap_or(0);
                if bytes > self.limits.database_batch_bytes {
                    return Err(ImportError::LimitExceeded.into());
                }
                if batch.records > 0
                    && (batch.records >= self.limits.database_batch_messages
                        || batch.bytes + bytes > self.limits.database_batch_bytes)
                {
                    self.flush(&mut batch).await?;
                }
                batch.records += 1;
                batch.bytes += bytes;
                batch.batch.checkpoint = current.next;
                if let Some(message) = message {
                    batch.batch.messages.push(message);
                } else {
                    batch.batch.skipped += 1;
                }
            }
            record = reader.next().await?;
        }
        self.flush(&mut batch).await?;
        // Search remains pending in the durable outbox; completion here means
        // history persistence, not queue publication or OpenSearch refresh.
        Ok(ConversationStatus::Completed)
    }

    async fn resolve_target(
        &self,
        context: &ClaimedConversation,
        users: &UserDirectory,
        first: Option<SlackTimestamp>,
    ) -> PortResult<Option<TargetPlan>> {
        let metadata = &context.metadata;
        let pair = if metadata.kind == ConversationKind::DirectMessage {
            let Some(pair) = users.direct_message_members(&metadata.member_ids) else {
                self.targets
                    .warn(&context.lease, ImportWarning::UnresolvableDirectMessage)
                    .await?;
                return Ok(None);
            };
            Some(pair)
        } else {
            None
        };
        let mut members: HashSet<_> = metadata
            .member_ids
            .iter()
            .filter_map(|id| users.participant(id))
            .collect();
        let requester_is_source_member = members.contains(&context.requested_by);
        let owner = match &pair {
            Some(pair) => pair
                .iter()
                .min_by(|a, b| a.as_ref().cmp(b.as_ref()))
                .expect("pair")
                .clone(),
            None => {
                members.insert(context.requested_by.clone());
                context.requested_by.clone()
            }
        };
        let name = if metadata.kind == ConversationKind::GroupDirectMessage {
            metadata
                .member_ids
                .iter()
                .map(|id| users.display_name(id))
                .collect::<Vec<_>>()
                .join(", ")
        } else {
            metadata.name.clone()
        };
        let mut warnings = Vec::new();
        let created_at = if let Some(ts) = metadata.created_at {
            timestamp(ts)?
        } else if let Some(ts) = first {
            warnings.push(ImportWarning::CreationTimeFromMessage);
            timestamp(ts)?
        } else {
            warnings.push(ImportWarning::CreationTimeFromJob);
            context.job_created_at
        };
        // Discovery is read-only: do not call an ensure-DM primitive before access
        // checks, since it can find an unrelated pair or race another creator.
        let existing = match &pair {
            Some(pair) => self.targets.find_dm(pair).await?,
            None => None,
        };
        if let Some(facts) = &existing {
            self.authorize(context, &members, facts).await?;
        }
        let reservation = self
            .ledger
            .reserve(
                context.team_id,
                &context.requested_by,
                metadata,
                existing.as_ref().map(|facts| facts.id),
            )
            .await?;
        if reservation.status == ReservationStatus::Conflict
            || reservation.team_id != context.team_id
            || reservation.slack_channel_id != metadata.slack_channel_id
        {
            return Err(ImportError::Unavailable.into());
        }
        let mut plan = TargetPlan {
            channel_id: reservation.channel_id,
            metadata: metadata.clone(),
            team_id: context.team_id,
            requested_by: context.requested_by.clone(),
            owner,
            members,
            name,
            created_at,
        };
        let created = match self.targets.inspect(plan.channel_id).await? {
            Some(facts) => {
                if facts.id != plan.channel_id {
                    return Err(ImportError::Unavailable.into());
                }
                self.authorize(context, &plan.members, &facts).await?;
                false
            }
            None if reservation.status == ReservationStatus::Ready => {
                return Err(ImportError::Unavailable.into());
            }
            None => {
                let (facts, created) = self.targets.create(&context.lease, &plan).await?;
                if facts.id != plan.channel_id || !compatible(context, &plan.members, &facts) {
                    return Err(ImportError::Unavailable.into());
                }
                if !created {
                    self.authorize(context, &plan.members, &facts).await?;
                }
                created
            }
        };
        if !created && !requester_is_source_member && pair.is_none() {
            // Reuse never adds the admin merely to establish ownership/access.
            plan.members.remove(&context.requested_by);
        }
        self.ledger.complete(&reservation, metadata.kind).await?;
        self.targets.bind(&context.lease, &plan, &warnings).await?;
        Ok(Some(plan))
    }

    async fn authorize(
        &self,
        context: &ClaimedConversation,
        members: &HashSet<MacroUserIdStr<'static>>,
        facts: &TargetFacts,
    ) -> PortResult<()> {
        if !compatible(context, members, facts) {
            return Err(ImportError::Unavailable.into());
        }
        self.authorizer
            .require_target(
                context.team_id,
                &context.requested_by,
                &context.metadata,
                facts.id,
            )
            .await
    }

    fn convert(
        &self,
        message: NormalizedMessage,
        order: u64,
        channel: Uuid,
        team: TeamId,
        users: &UserDirectory,
        converter: &MrkdwnConverter<'_>,
    ) -> Option<HistoricalMessage> {
        let MessageConversion::Text(content) = converter.message(&message.content) else {
            return None;
        };
        let (sender, imported_author) = match users.author(&message.content) {
            ResolvedAuthor::User(user) => (HistoricalSender::User(user), None),
            ResolvedAuthor::SystemBot { imported_author } => {
                (HistoricalSender::SystemBot, Some(imported_author))
            }
        };
        let parent_ts = message
            .thread_reference()
            .parent_lookup()
            .map(|parent| parent.ts);
        let reactions = reactions::convert(&message.content.reactions, users, message.identity.ts);
        Some(HistoricalMessage {
            id: Uuid::now_v7(),
            source: message.identity.in_team(team),
            channel_id: channel,
            parent_id: None,
            orphaned_thread_ts: parent_ts,
            sender,
            imported_author,
            content,
            import_order: order,
            reactions,
        })
    }

    async fn flush(&self, pending: &mut PendingBatch) -> PortResult<()> {
        if pending.records == 0 {
            return Ok(());
        }
        let mut sources = HashSet::new();
        for message in &pending.batch.messages {
            sources.insert(message.source.clone());
            if let Some(ts) = message.orphaned_thread_ts {
                sources.insert(SourceMessageId {
                    ts,
                    ..message.source.clone()
                });
            }
        }
        let sources: Vec<_> = sources.into_iter().collect();
        let mut mappings = HashMap::new();
        for chunk in sources.chunks(self.limits.database_batch_messages as usize) {
            mappings.extend(self.sink.lookup(chunk).await?);
        }
        // Durable IDs beat speculative IDs, including an existing root in this
        // batch. The atomic sink re-resolves races and must not overwrite live edits.
        for message in &mut pending.batch.messages {
            if let Some(id) = mappings.get(&message.source) {
                message.id = *id;
            }
        }
        for message in &mut pending.batch.messages {
            if let Some(ts) = message.orphaned_thread_ts {
                let parent = SourceMessageId {
                    ts,
                    ..message.source.clone()
                };
                if let Some(id) = mappings.get(&parent) {
                    message.parent_id = Some(*id);
                    message.orphaned_thread_ts = None;
                }
            }
            mappings.entry(message.source.clone()).or_insert(message.id);
        }
        let batch = HistoricalBatch {
            lease: pending.batch.lease.clone(),
            messages: std::mem::take(&mut pending.batch.messages),
            checkpoint: pending.batch.checkpoint,
            skipped: pending.batch.skipped,
        };
        self.sink.commit(batch).await?;
        pending.batch.skipped = 0;
        pending.records = 0;
        pending.bytes = 0;
        Ok(())
    }
}

fn compatible(
    context: &ClaimedConversation,
    members: &HashSet<MacroUserIdStr<'static>>,
    facts: &TargetFacts,
) -> bool {
    match (context.metadata.kind, facts.kind) {
        (ConversationKind::PublicChannel, TargetKind::Team(team)) => team == context.team_id,
        (
            ConversationKind::PrivateChannel | ConversationKind::GroupDirectMessage,
            TargetKind::Private,
        ) => true,
        (ConversationKind::DirectMessage, TargetKind::DirectMessage) => {
            facts.dm_members.len() == 2 && &facts.dm_members == members
        }
        _ => false,
    }
}

fn timestamp(ts: SlackTimestamp) -> PortResult<DateTime<Utc>> {
    DateTime::from_timestamp_micros(ts.unix_micros())
        .ok_or_else(|| ImportError::InvalidInput.into())
}

struct PendingBatch {
    batch: HistoricalBatch,
    records: u32,
    bytes: u64,
}

impl PendingBatch {
    fn new(context: &ClaimedConversation) -> Self {
        Self {
            batch: HistoricalBatch {
                lease: context.lease.clone(),
                messages: Vec::new(),
                checkpoint: context.checkpoint,
                skipped: 0,
            },
            records: 0,
            bytes: 0,
        }
    }
}

/// Serialized message payload bound, also usable by the atomic coordinator.
/// Includes metadata/reactions and headroom for resolving a pending parent UUID.
pub fn historical_message_bytes(message: &HistoricalMessage) -> PortResult<u64> {
    let parent_headroom = if message.parent_id.is_none() && message.orphaned_thread_ts.is_some() {
        36
    } else {
        0
    };
    serde_json::to_vec(message)
        .map(|bytes| bytes.len() as u64 + parent_headroom)
        .map_err(|_| ImportError::Internal.into())
}

/// Reconcile one durable dirty generation. Persist the ACTUAL service receipt;
/// repeated submissions are safe because scoped search publication uses upserts.
/// Completed means durable publication, not eventual consumer indexing/refresh.
/// Running receipts are not rewritten, preserving their original stale deadline.
pub async fn reconcile_search(
    repo: &impl ExecutionRepo,
    client: &impl SearchBackfillClient,
    clock: &impl Clock,
    request: &SearchBackfill,
) -> PortResult<()> {
    match request.state {
        SearchState::NotNeeded | SearchState::Completed => return Ok(()),
        SearchState::Submitted { receipt_id } => match client.progress(receipt_id).await? {
            SearchState::Completed => {
                return repo.record_search(request, SearchState::Completed).await;
            }
            SearchState::Submitted { receipt_id: polled } if polled == receipt_id => {
                if clock.now().signed_duration_since(request.updated_at) < Duration::minutes(30) {
                    return Ok(());
                }
            }
            SearchState::Failed => (),
            _ => return Err(ImportError::Retryable.into()),
        },
        SearchState::Pending | SearchState::Failed => (),
    }
    let receipt_id = client.submit(request).await?;
    repo.record_search(request, SearchState::Submitted { receipt_id })
        .await
}
