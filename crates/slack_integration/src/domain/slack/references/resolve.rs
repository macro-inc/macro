//! Bounded read-only resolution policy. Source proof precedes identity lookup;
//! import provenance never substitutes for current disclosure permission.

use std::collections::{HashMap, HashSet};

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{ConvertedText, MAX_REFERENCES, ResolvedTarget, SourceReference};
use crate::domain::{
    models::*,
    ports::{PortResult, ReferenceLookup},
};

/// Durable mapping without claims about message existence, ownership or access.
#[derive(Debug, Clone)]
pub struct StoredMessageMapping {
    /// Exact source identity.
    pub source: SourceMessageId,
    /// Mapped channel, to compare against actual message ownership.
    pub channel: Uuid,
    /// Mapped message.
    pub message: Uuid,
}

/// Persisted job scope, supplied by a trusted repository, not archive text.
#[derive(Debug, Clone)]
pub struct ReferenceContext {
    /// Team namespace.
    pub team: TeamId,
    /// Job whose selected work may still supply missing mappings.
    pub job: JobId,
    /// Original administrator; current read access is checked separately.
    pub requester: MacroUserIdStr<'static>,
    /// Archive identity or explicit unknown-source confirmation.
    pub source: SourceIdentity,
    /// Current durable source binding.
    pub binding: SourceBinding,
    /// Independently established workspace/domain associations. Production v1 has
    /// no domain-evidence store and MUST leave this empty. Never derive from URLs,
    /// archive labels, unknown-source confirmation, DNS, or a network fetch.
    pub domains: Vec<WorkspaceDomain>,
}

/// Trusted same-source evidence, not a domain claim from the archive or URL.
#[derive(Debug, Clone)]
pub struct WorkspaceDomain {
    /// Workspace proven to own this exact hostname.
    pub source: SourceId,
    /// Exact normalized hostname; aliases require their own proof.
    pub hostname: String,
}

/// Canonical channel facts, still requiring disclosure authorization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelMapping {
    /// No compatible mapping. May still be selected in this job.
    Missing,
    /// A reservation exists, but no canonical created target may be disclosed.
    Pending,
    /// Existing, type/team-compatible channel from this bound namespace.
    Ready {
        /// Canonical channel.
        id: Uuid,
        /// Whether team membership grants read access (never true for private/DM).
        team_visible: bool,
        /// Persisted label; not yet authorized for disclosure.
        name: String,
    },
}

/// Exact source lookup result. Mapping and actual owning message must agree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageMapping {
    /// Absent mapping; selected work may still produce it.
    Missing,
    /// Mapping exists but its message is deleted or ownership is inconsistent.
    Invalid,
    /// Durable mapping and live message/root agree on the canonical channel.
    Ready {
        /// Mapping's canonical channel, checked against actual ownership.
        channel: Uuid,
        /// Actual message UUID, never a reserved candidate.
        message: Uuid,
        /// Actual persisted root (self for roots/orphan-imported replies).
        root: Uuid,
    },
}

/// Facts from current read-access checks, not import-write authorization.
#[derive(Debug, Clone, Default)]
pub struct DisclosureAccess {
    /// Requester currently belongs to the explicit team.
    pub team_member: bool,
    /// Active participant channels; historical leavers are excluded.
    pub participant_channels: HashSet<Uuid>,
}

/// No target metadata is carried by a pending or fallback result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReferenceOutcome {
    /// Current read access and canonical identity are established.
    Resolved(ResolvedTarget),
    /// Retry after selected work settles. Never render a speculative UUID.
    Pending,
    /// Keep the original escaped token/external link verbatim.
    Fallback,
}

impl ReferenceContext {
    fn compatible(&self) -> bool {
        match (&self.source, &self.binding) {
            (_, SourceBinding::Unbound) => false,
            (SourceIdentity::Known { source_id }, SourceBinding::Known { source_id: bound }) => {
                source_id == bound
            }
            (SourceIdentity::Known { .. }, _) => false,
            (SourceIdentity::ConfirmedUnknown, _) => true,
        }
    }

    fn permits(&self, reference: &SourceReference) -> bool {
        if !self.compatible() {
            return false;
        }
        match reference {
            SourceReference::Channel { .. } => true,
            SourceReference::Message { hostname, .. } => {
                let SourceBinding::Known { source_id } = &self.binding else {
                    return false;
                };
                self.domains
                    .iter()
                    .any(|domain| domain.source == *source_id && domain.hostname == *hostname)
            }
        }
    }
}

/// Resolve one database-sized batch of converter records. Deduplicate exact source
/// identities, then chunk database calls at the record ceiling. The entire batch,
/// including template/intents, must fit the database byte ceiling. No archive map.
/// Call again during deferred reconciliation; this never persists replacements.
pub async fn resolve_batch<R: ReferenceLookup>(
    lookup: &R,
    context: &ReferenceContext,
    records: &[ConvertedText],
    limits: &ImportLimits,
) -> PortResult<Vec<Vec<ReferenceOutcome>>> {
    let max = limits
        .database_batch_messages
        .min(ImportLimits::default().database_batch_messages) as usize;
    if max == 0 || records.len() > max {
        return Err(ImportError::LimitExceeded.into());
    }
    let mut bytes = 0_u64;
    for record in records {
        if record.references.len() > MAX_REFERENCES || record.user_mentions.len() > MAX_REFERENCES {
            return Err(ImportError::LimitExceeded.into());
        }
        bytes = bytes
            .checked_add(
                serde_json::to_vec(record)
                    .map_err(|_| ImportError::InvalidInput)?
                    .len() as u64,
            )
            .ok_or(ImportError::LimitExceeded)?;
        if bytes
            > limits
                .database_batch_bytes
                .min(ImportLimits::default().database_batch_bytes)
        {
            return Err(ImportError::LimitExceeded.into());
        }
        record.render(&[]).map_err(|_| ImportError::InvalidInput)?;
    }
    let mut channels = HashSet::new();
    let mut sources = HashSet::new();
    for intent in records.iter().flat_map(|record| &record.references) {
        if !context.permits(&intent.source) {
            continue;
        }
        match &intent.source {
            SourceReference::Channel { channel } => {
                channels.insert(channel.clone());
            }
            SourceReference::Message {
                channel, timestamp, ..
            } => {
                channels.insert(channel.clone());
                sources.insert(SourceMessageId {
                    team_id: context.team,
                    slack_channel_id: channel.clone(),
                    ts: *timestamp,
                });
            }
        }
    }
    let channels: Vec<_> = channels.into_iter().collect();
    let sources: Vec<_> = sources.into_iter().collect();
    let mut targets = HashMap::new();
    let mut pending = HashSet::new();
    for chunk in channels.chunks(max) {
        let rows = lookup.channels(context, chunk).await?;
        if rows.len() != chunk.len() {
            return Err(ImportError::Internal.into());
        }
        targets.extend(chunk.iter().cloned().zip(rows));
        pending.extend(lookup.pending_channels(context, chunk).await?);
    }
    let mut messages = HashMap::new();
    for chunk in sources.chunks(max) {
        let rows = lookup.messages(context, chunk).await?;
        if rows.len() != chunk.len() {
            return Err(ImportError::Internal.into());
        }
        messages.extend(chunk.iter().cloned().zip(rows));
    }
    let ids: Vec<_> = targets
        .values()
        .filter_map(|mapping| match mapping {
            ChannelMapping::Ready { id, .. } => Some(*id),
            _ => None,
        })
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let mut access = DisclosureAccess::default();
    for chunk in ids.chunks(max) {
        let facts = lookup.disclosure_access(context, chunk).await?;
        access.team_member = facts.team_member;
        access
            .participant_channels
            .extend(facts.participant_channels);
    }
    Ok(records
        .iter()
        .map(|record| {
            record
                .references
                .iter()
                .map(|intent| {
                    resolve_reference(
                        context,
                        &intent.source,
                        &targets,
                        &pending,
                        &messages,
                        &access,
                    )
                })
                .collect()
        })
        .collect())
}

fn resolve_reference(
    context: &ReferenceContext,
    reference: &SourceReference,
    targets: &HashMap<ConversationId, ChannelMapping>,
    pending: &HashSet<ConversationId>,
    messages: &HashMap<SourceMessageId, MessageMapping>,
    access: &DisclosureAccess,
) -> ReferenceOutcome {
    if !context.permits(reference) {
        return ReferenceOutcome::Fallback;
    }
    let channel = match reference {
        SourceReference::Channel { channel } | SourceReference::Message { channel, .. } => channel,
    };
    let (id, name, team_visible) = match targets.get(channel) {
        Some(ChannelMapping::Ready {
            id,
            name,
            team_visible,
        }) => (*id, name, *team_visible),
        Some(ChannelMapping::Pending) => return ReferenceOutcome::Pending,
        _ if pending.contains(channel) => return ReferenceOutcome::Pending,
        _ => return ReferenceOutcome::Fallback,
    };
    if !(access.participant_channels.contains(&id) || (team_visible && access.team_member)) {
        return ReferenceOutcome::Fallback;
    }
    let SourceReference::Message { timestamp, .. } = reference else {
        return ReferenceOutcome::Resolved(ResolvedTarget::Channel {
            channel_id: id,
            name: name.clone(),
        });
    };
    let source = SourceMessageId {
        team_id: context.team,
        slack_channel_id: channel.clone(),
        ts: *timestamp,
    };
    match messages.get(&source) {
        Some(MessageMapping::Ready {
            channel,
            message,
            root,
        }) if *channel == id => ReferenceOutcome::Resolved(ResolvedTarget::Message {
            channel_id: id,
            name: name.clone(),
            message_id: *message,
            thread_id: Some(*root),
        }),
        Some(MessageMapping::Missing) if pending.contains(channel) => ReferenceOutcome::Pending,
        _ => ReferenceOutcome::Fallback,
    }
}
