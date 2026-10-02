//! One transaction per historical batch, composing only owning-crate SQL helpers.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use channel_sender::ChannelSender;
use channels::{
    domain::{
        dm::DmPair,
        historical::{DmCreation, HistoricalChannel, HistoricalChannelKind},
    },
    outbound::pg_channels_repo::{PgChannelsRepo, historical as channels_pg},
};
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use import::outbound::pg_import_repo::targets as ledger;
use macro_user_id::user_id::MacroUserIdStr;
use messages::{
    domain::historical as messages_model, outbound::pg_message_repo::PgMessageRepository,
};
use slack_integration::{
    domain::{
        importer::{
            historical_message_bytes,
            targets::{ImportTargets, TargetFacts, TargetPlan},
        },
        models::*,
        ports::{HistoricalSink, ImportAuthorizer, PortResult},
        reference_reconciliation::IMPORTER_BODY_VERSION,
    },
    outbound::pg_slack_import_repo::{
        batches::{self, BatchStart, WriteContext},
        references,
    },
};
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    authorizer::{WorkerAuthorizer, inspect},
    ledger_error, retry, target_key, target_kind,
};

/// Concrete atomic sink and silent channel adapter for `ConversationImporter`.
#[derive(Clone)]
pub struct ChannelImportSink<A> {
    pool: PgPool,
    authorizer: WorkerAuthorizer<A>,
    limits: ImportLimits,
}

impl<A: EntityAccessService> ChannelImportSink<A> {
    /// Share one pool across all participating owning-crate helpers.
    pub fn new(
        pool: PgPool,
        authorizer: WorkerAuthorizer<A>,
        limits: ImportLimits,
    ) -> Result<Self, ImportError> {
        if limits.database_batch_messages == 0
            || limits.database_batch_messages > ImportLimits::default().database_batch_messages
            || limits.database_batch_bytes == 0
            || limits.database_batch_bytes > ImportLimits::default().database_batch_bytes
        {
            return Err(ImportError::InvalidInput);
        }
        Ok(Self {
            pool,
            authorizer,
            limits,
        })
    }
}

impl<A: EntityAccessService> HistoricalSink for ChannelImportSink<A> {
    async fn lookup(
        &self,
        sources: &[SourceMessageId],
    ) -> PortResult<Vec<(SourceMessageId, Uuid)>> {
        batches::lookup(&mut *self.pool.acquire().await.map_err(retry)?, sources).await
    }

    async fn commit(&self, mut batch: HistoricalBatch) -> PortResult<ImportCounters> {
        let records = (batch.messages.len() as u64)
            .checked_add(batch.skipped)
            .ok_or(ImportError::LimitExceeded)?;
        if records > u64::from(self.limits.database_batch_messages) {
            return Err(ImportError::LimitExceeded.into());
        }
        let mut bytes = 0_u64;
        for message in &batch.messages {
            bytes = bytes
                .checked_add(historical_message_bytes(message)?)
                .ok_or(ImportError::LimitExceeded)?;
        }
        if bytes > self.limits.database_batch_bytes {
            return Err(ImportError::LimitExceeded.into());
        }
        let mut tx = self.pool.begin().await.map_err(retry)?;
        let context = batches::write_context(&mut tx, &batch.lease).await?;
        let channel = context.channel.ok_or(ImportError::Unavailable)?;
        self.authorizer
            .target_in(
                &mut tx,
                &target_key(context.team, &batch.lease.event.slack_channel_id)?,
                &context.requester,
                context.kind,
                channel,
                true,
            )
            .await?;
        let start = batches::begin_batch(
            &mut tx,
            &batch.lease,
            context.checkpoint,
            batch.checkpoint,
            Some(channel),
        )
        .await?;
        let mut fenced = match start {
            BatchStart::Replayed(counters) => return Ok(counters),
            BatchStart::Ready(fenced) => fenced,
        };
        // Speculative IDs from domain parent resolution are not durable authority.
        // Resolve again after the canonical source lock; generate only missing IDs.
        let sources: Vec<_> = batch.messages.iter().map(|m| m.source.clone()).collect();
        let existing: HashMap<_, _> = batches::lookup(fenced.transaction(), &sources)
            .await?
            .into_iter()
            .collect();
        let original_ids: Vec<_> = batch.messages.iter().map(|message| message.id).collect();
        for message in &mut batch.messages {
            let id = existing
                .get(&message.source)
                .copied()
                .unwrap_or_else(Uuid::now_v7);
            message.id = id;
        }
        let mappings = fenced.reserve_mappings(&batch.messages).await?;
        // Reservation arbitration, not the earlier read, determines final IDs.
        let remapped: HashMap<_, _> = original_ids
            .into_iter()
            .zip(mappings.iter().map(|mapping| mapping.message_id))
            .collect();
        let missing_parents: Vec<_> = batch
            .messages
            .iter()
            .filter_map(|m| {
                m.orphaned_thread_ts.map(|ts| SourceMessageId {
                    ts,
                    ..m.source.clone()
                })
            })
            .collect();
        let mut parents: HashMap<_, _> = batches::lookup(fenced.transaction(), &missing_parents)
            .await?
            .into_iter()
            .collect();
        parents.extend(mappings.iter().map(|m| (m.source.clone(), m.message_id)));
        let mut messages = Vec::new();
        let mut reactions = 0;
        for (mut message, mapping) in batch.messages.into_iter().zip(mappings) {
            if !mapping.inserted {
                continue;
            } // First commit wins, including reactions and live edits.
            message.id = mapping.message_id;
            if let Some(parent) = message.parent_id {
                message.parent_id = Some(remapped.get(&parent).copied().unwrap_or(parent));
            }
            if let Some(ts) = message.orphaned_thread_ts
                && let Some(parent) = parents.get(&SourceMessageId {
                    ts,
                    ..message.source.clone()
                })
            {
                message.parent_id = Some(*parent);
                message.orphaned_thread_ts = None;
            }
            references::insert_in(fenced.transaction(), &batch.lease, &message).await?;
            let message = convert(message, batch.lease.event.job_id)?;
            reactions += message.reactions.len() as u64;
            messages.push(message);
        }
        let activity = messages.iter().map(|m| m.created_at).max();
        PgMessageRepository::insert_historical_in(
            fenced.transaction(),
            &messages_model::HistoricalBatch {
                channel_id: channel,
                messages,
            },
        )
        .await
        .map_err(|error| {
            use messages::domain::ports::MessageError;
            match error {
                MessageError::Invalid(_) | MessageError::Conflict => {
                    ImportError::InvalidInput.into()
                }
                other => retry(other),
            }
        })?;
        if let Some(activity) = activity {
            channels_pg::advance_historical_activity(fenced.transaction(), channel, activity)
                .await
                .map_err(retry)?;
        }
        let counters = fenced.finish(batch.skipped, reactions).await?;
        tx.commit().await.map_err(retry)?;
        Ok(counters)
    }
}

impl<A: EntityAccessService> ImportTargets for ChannelImportSink<A> {
    async fn find_dm(
        &self,
        pair: &[MacroUserIdStr<'static>; 2],
    ) -> PortResult<Option<TargetFacts>> {
        let pair =
            DmPair::new(pair[0].clone(), pair[1].clone()).map_err(|_| ImportError::InvalidInput)?;
        let mut tx = self.pool.begin().await.map_err(retry)?;
        let Some(id) = channels_pg::find_dm(&mut tx, &pair).await.map_err(retry)? else {
            return Ok(None);
        };
        Ok(inspect(&mut tx, id, None).await?.map(|(facts, _)| facts))
    }

    async fn inspect(&self, channel: Uuid) -> PortResult<Option<TargetFacts>> {
        let mut tx = self.pool.begin().await.map_err(retry)?;
        // Discovery returns no authority; every mutation checks the real requester.
        Ok(inspect(&mut tx, channel, None)
            .await?
            .map(|(facts, _)| facts))
    }

    async fn create(&self, lease: &Lease, plan: &TargetPlan) -> PortResult<(TargetFacts, bool)> {
        let mut tx = self.pool.begin().await.map_err(retry)?;
        let context = batches::write_context(&mut tx, lease).await?;
        validate_plan(&context, lease, plan)?;
        self.authorizer
            .require_admin(context.team, &context.requester)
            .await?;
        let key = target_key(context.team, &lease.event.slack_channel_id)?;
        ledger::lock_target_in(
            &mut tx,
            &key,
            plan.channel_id,
            target_kind(context.kind),
            true,
        )
        .await
        .map_err(ledger_error)?;
        if inspect(&mut tx, plan.channel_id, Some(&context.requester))
            .await?
            .is_some()
        {
            let facts = self
                .authorizer
                .target_in(
                    &mut tx,
                    &key,
                    &context.requester,
                    context.kind,
                    plan.channel_id,
                    true,
                )
                .await?;
            validate_pair(plan, &facts)?;
            batches::write_context(&mut tx, lease).await?;
            tx.commit().await.map_err(retry)?;
            return Ok((facts, false));
        }
        let created = match context.kind {
            ConversationKind::DirectMessage => {
                let mut members = plan.members.iter();
                if plan.members.len() != 2 {
                    return Err(ImportError::InvalidInput.into());
                }
                let pair = DmPair::new(
                    members.next().unwrap().clone(),
                    members.next().unwrap().clone(),
                )
                .map_err(|_| ImportError::InvalidInput)?;
                channels_pg::ensure_dm_in(
                    &mut tx,
                    pair,
                    DmCreation::Historical {
                        id: plan.channel_id,
                        created_at: plan.created_at,
                    },
                )
                .await
                .map_err(retry)?
            }
            kind => PgChannelsRepo::ensure_reserved_channel_in(
                &mut tx,
                &HistoricalChannel {
                    id: plan.channel_id,
                    name: plan.name.clone(),
                    owner: plan.owner.clone(),
                    participants: plan.members.clone(),
                    created_at: plan.created_at,
                    kind: if kind == ConversationKind::PublicChannel {
                        HistoricalChannelKind::Team(context.team.into())
                    } else {
                        HistoricalChannelKind::Private
                    },
                },
                false,
            )
            .await
            .map_err(retry)?,
        };
        if created.id != plan.channel_id || !created.created {
            return Err(ImportError::Unavailable.into());
        }
        // Creation and provenance commit together. A retry also recovers older
        // pending reservations with an existing authorized channel via bind/complete.
        ledger::complete_target_in(&mut tx, &key, plan.channel_id, target_kind(context.kind))
            .await
            .map_err(ledger_error)?;
        let facts = self
            .authorizer
            .target_in(
                &mut tx,
                &key,
                &context.requester,
                context.kind,
                plan.channel_id,
                true,
            )
            .await?;
        validate_pair(plan, &facts)?;
        batches::write_context(&mut tx, lease).await?;
        tx.commit().await.map_err(retry)?;
        Ok((facts, true))
    }

    async fn bind(
        &self,
        lease: &Lease,
        plan: &TargetPlan,
        warnings: &[ImportWarning],
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(retry)?;
        let context = batches::write_context(&mut tx, lease).await?;
        validate_plan(&context, lease, plan)?;
        let facts = self
            .authorizer
            .target_in(
                &mut tx,
                &target_key(context.team, &lease.event.slack_channel_id)?,
                &context.requester,
                context.kind,
                plan.channel_id,
                true,
            )
            .await?;
        validate_pair(plan, &facts)?;
        if context.kind != ConversationKind::DirectMessage {
            channels_pg::insert_members(
                &mut tx,
                plan.channel_id,
                &plan.members.iter().cloned().collect::<Vec<_>>(),
                plan.created_at,
            )
            .await
            .map_err(retry)?;
        }
        batches::bind_target(&mut tx, lease, plan.channel_id).await?;
        batches::record_warnings(&mut tx, lease, warnings).await?;
        tx.commit().await.map_err(retry)
    }

    async fn warn(&self, lease: &Lease, warning: ImportWarning) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(retry)?;
        batches::record_warnings(&mut tx, lease, &[warning]).await?;
        tx.commit().await.map_err(retry)
    }
}

fn validate_plan(context: &WriteContext, lease: &Lease, plan: &TargetPlan) -> PortResult<()> {
    if context.team != plan.team_id
        || context.requester != plan.requested_by
        || context.kind != plan.metadata.kind
        || lease.event.slack_channel_id != plan.metadata.slack_channel_id
        || context.channel.is_some_and(|id| id != plan.channel_id)
    {
        return Err(ImportError::Unavailable.into());
    }
    Ok(())
}

fn validate_pair(plan: &TargetPlan, facts: &TargetFacts) -> PortResult<()> {
    if plan.metadata.kind == ConversationKind::DirectMessage && facts.dm_members != plan.members {
        return Err(ImportError::Unavailable.into());
    }
    Ok(())
}

fn timestamp(ts: SlackTimestamp) -> PortResult<DateTime<Utc>> {
    DateTime::from_timestamp_micros(ts.unix_micros())
        .ok_or_else(|| ImportError::InvalidInput.into())
}

fn convert(
    message: HistoricalMessage,
    job: JobId,
) -> PortResult<messages_model::HistoricalMessage> {
    let created_at = timestamp(message.source.ts)?;
    let mut seen = HashSet::new();
    let mut reactions = Vec::new();
    for reaction in message.reactions {
        if seen.insert((reaction.user_id.clone(), reaction.emoji.clone())) {
            reactions.push(messages_model::HistoricalReaction {
                user_id: reaction.user_id,
                emoji: reaction.emoji,
                created_at: timestamp(reaction.created_at)?,
            });
        }
    }
    if message.user_mentions.len() > slack_integration::domain::slack::references::MAX_REFERENCES {
        return Err(ImportError::LimitExceeded.into());
    }
    let mut users = HashSet::new();
    let mentions = message
        .user_mentions
        .into_iter()
        .filter(|user| users.insert(user.clone()))
        .map(|user_id| messages_model::HistoricalUserMention {
            id: Uuid::now_v7(),
            user_id,
        })
        .collect();
    Ok(messages_model::HistoricalMessage {
        id: message.id,
        thread_id: message.parent_id,
        sender: match message.sender {
            HistoricalSender::User(user) => ChannelSender::new_from_user(user),
            HistoricalSender::SystemBot => ChannelSender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID),
        },
        imported_author: message.imported_author,
        content: message.content,
        created_at,
        updated_at: created_at,
        edited_at: None,
        import_metadata: serde_json::json!({
            "source": "slack",
            "slack_channel_id": message.source.slack_channel_id,
            "slack_ts": message.source.ts,
            "orphaned_thread_ts": message.orphaned_thread_ts,
            "slack_import_job": Uuid::from(job),
            "body_version": IMPORTER_BODY_VERSION,
        }),
        import_order: i64::try_from(message.import_order).map_err(|_| ImportError::InvalidInput)?,
        reactions,
        mentions,
    })
}
