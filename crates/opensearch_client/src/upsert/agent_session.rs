use std::collections::BTreeSet;

use models_opensearch::SearchIndex;
use opensearch::BulkParts;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    Result,
    agent_session::{
        IndexedMessages, delete_by_id, fenced_action, response_error, stored_parent,
        unrecorded_children,
    },
    date_format::EpochMillis,
    error::{OpensearchClientError, OpensearchOperation},
};

#[cfg(test)]
mod test;

const PARENT_RELATION: &str = "agent_session";
const CHILD_RELATION: &str = "message";
/// Hex digits of a message's SHA-256 kept in the parent's record: enough to
/// tell two versions of one message apart without bloating the parent.
const CONTENT_HASH_HEX_DIGITS: usize = 16;

/// The two author sides of a folded conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::Display)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum AgentSessionMessageAuthor {
    /// A user's prompt.
    User,
    /// The agent's reply.
    Agent,
}

/// One folded message in an authoritative agent-session projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSessionMessageDocument {
    /// Stable turn number assigned by `agent_fold`.
    pub turn: u32,
    /// Stable author side (`user` or `agent`).
    pub author: AgentSessionMessageAuthor,
    /// Attributed user for a user-authored prompt, when known.
    pub author_user_id: Option<String>,
    /// Text flattened from the folded, renderable message vocabulary.
    pub content: String,
}

/// Complete searchable projection of one agent session.
#[derive(Debug, Clone)]
pub struct ReconcileAgentSessionArgs {
    /// Agent-session UUID.
    pub agent_session_id: String,
    /// User-facing session name.
    pub name: String,
    /// Owner recorded by the authoritative session row.
    pub owner_id: String,
    /// Agent persona behind the session.
    pub bot_id: String,
    /// Originating thread, when the session was opened from one.
    pub thread_id: Option<String>,
    /// Message that opened the session, when any.
    pub originating_message_id: Option<String>,
    /// Session creation time.
    pub created_at_millis: EpochMillis,
    /// Latest persisted session metadata time.
    pub updated_at_millis: EpochMillis,
    /// Carried by every write as an `external_gte` version, so the index
    /// refuses a delayed write from an earlier reconcile; it must grow with
    /// each reconcile of the session.
    pub version: u64,
    /// Every currently folded message, oldest first.
    pub messages: Vec<AgentSessionMessageDocument>,
}

/// What one reconcile changed in the index.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AgentSessionReconcileWrites {
    /// The parent document was rewritten.
    pub parent_written: bool,
    /// Message children written because they were new or changed.
    pub messages_written: usize,
    /// Message children left alone because the index already held them.
    pub messages_unchanged: usize,
    /// Message children removed because the session no longer has them.
    pub messages_deleted: usize,
}

#[derive(Serialize)]
struct ParentDocument<'a> {
    agent_session_id: &'a str,
    name: &'a str,
    owner_id: &'a str,
    bot_id: &'a str,
    thread_id: Option<&'a str>,
    originating_message_id: Option<&'a str>,
    created_at_millis: EpochMillis,
    updated_at_millis: EpochMillis,
    agent_session_relation: &'static str,
    /// Child id to content hash of each child this parent vouches for: every
    /// message, except while a reconcile changes some and names them pending.
    /// Kept in `_source` only: the mapping is not dynamic, so it is never indexed.
    indexed_messages: &'a IndexedMessages,
    /// Children a reconcile set out to write or delete and did not confirm:
    /// the next one rewrites or deletes them whatever their hash says.
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    pending_messages: &'a [String],
}

#[derive(Serialize)]
struct ChildDocument<'a> {
    agent_session_id: &'a str,
    message_turn: u32,
    author: AgentSessionMessageAuthor,
    author_user_id: Option<&'a str>,
    content: &'a str,
    agent_session_relation: ChildRelation<'a>,
}

#[derive(Serialize)]
struct ChildRelation<'a> {
    name: &'static str,
    parent: &'a str,
}

/// The index writes that bring the stored children in line with a snapshot.
#[derive(Debug, Default)]
struct ReconcilePlan {
    /// Child id and serialized document of each new or changed message.
    write: Vec<(String, String)>,
    /// Ids of recorded or pending children the snapshot no longer has.
    delete: Vec<String>,
    unchanged: usize,
    /// The record the parent holds once the writes succeed.
    record: IndexedMessages,
}

fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::AgentSessions.as_ref())
}

fn child_id(agent_session_id: &str, message: &AgentSessionMessageDocument) -> String {
    format!("{agent_session_id}:{}:{}", message.turn, message.author)
}

fn parent_document<'a>(
    args: &'a ReconcileAgentSessionArgs,
    record: &'a IndexedMessages,
    pending: &'a [String],
) -> ParentDocument<'a> {
    ParentDocument {
        agent_session_id: &args.agent_session_id,
        name: &args.name,
        owner_id: &args.owner_id,
        bot_id: &args.bot_id,
        thread_id: args.thread_id.as_deref(),
        originating_message_id: args.originating_message_id.as_deref(),
        created_at_millis: args.created_at_millis,
        updated_at_millis: args.updated_at_millis,
        agent_session_relation: PARENT_RELATION,
        indexed_messages: record,
        pending_messages: pending,
    }
}

fn child_document<'a>(
    args: &'a ReconcileAgentSessionArgs,
    message: &'a AgentSessionMessageDocument,
) -> ChildDocument<'a> {
    ChildDocument {
        agent_session_id: &args.agent_session_id,
        message_turn: message.turn,
        author: message.author,
        author_user_id: message.author_user_id.as_deref(),
        content: &message.content,
        agent_session_relation: ChildRelation {
            name: CHILD_RELATION,
            parent: &args.agent_session_id,
        },
    }
}

fn content_hash(document: &str) -> String {
    let digest = Sha256::digest(document.as_bytes());
    digest
        .iter()
        .take(CONTENT_HASH_HEX_DIGITS / 2)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The OpenSearch form of a write version, which is a signed long.
pub(crate) fn external_version(version: u64, operation: OpensearchOperation) -> Result<i64> {
    i64::try_from(version).map_err(|error| OpensearchClientError::SerializationFailed {
        details: error.to_string(),
        operation,
    })
}

fn serialization_error(
    operation: OpensearchOperation,
    error: serde_json::Error,
) -> OpensearchClientError {
    OpensearchClientError::SerializationFailed {
        details: error.to_string(),
        operation,
    }
}

/// Compares the snapshot's messages with the parent's record of what the
/// index holds. With no record, every message is written; a pending message
/// is rewritten, or deleted when the snapshot no longer has it.
fn plan(
    args: &ReconcileAgentSessionArgs,
    previous: Option<&IndexedMessages>,
    pending: &[String],
) -> Result<ReconcilePlan> {
    let pending: BTreeSet<&str> = pending.iter().map(String::as_str).collect();
    let mut plan = ReconcilePlan::default();
    for message in &args.messages {
        let id = child_id(&args.agent_session_id, message);
        let document = serde_json::to_string(&child_document(args, message)).map_err(|error| {
            serialization_error(OpensearchOperation::ReconcileAgentSessionBulk, error)
        })?;
        let hash = content_hash(&document);

        let recorded = previous.and_then(|record| record.get(&id)) == Some(&hash);
        if recorded && !pending.contains(id.as_str()) {
            plan.unchanged += 1;
        } else {
            plan.write.push((id.clone(), document));
        }
        plan.record.insert(id, hash);
    }

    let known: BTreeSet<&str> = previous
        .into_iter()
        .flat_map(|record| record.keys().map(String::as_str))
        .chain(pending)
        .collect();
    plan.delete = known
        .into_iter()
        .filter(|id| !plan.record.contains_key(*id))
        .map(str::to_owned)
        .collect();
    Ok(plan)
}

impl ReconcilePlan {
    fn touches_children(&self) -> bool {
        !self.write.is_empty() || !self.delete.is_empty()
    }

    /// The record of the children this plan leaves alone, and the ids it is
    /// about to write or delete, for the parent to hold while it does.
    fn intent(&self) -> (IndexedMessages, Vec<String>) {
        let touched: Vec<String> = self
            .write
            .iter()
            .map(|(id, _)| id.clone())
            .chain(self.delete.iter().cloned())
            .collect();
        let touched_ids: BTreeSet<&str> = touched.iter().map(String::as_str).collect();
        let untouched = self
            .record
            .iter()
            .filter(|(id, _)| !touched_ids.contains(id.as_str()))
            .map(|(id, hash)| (id.clone(), hash.clone()))
            .collect();
        (untouched, touched)
    }
}

#[tracing::instrument(skip_all, fields(written = plan.write.len(), deleted = plan.delete.len()))]
async fn write_children(
    client: &opensearch::OpenSearch,
    index: &str,
    routing: &str,
    plan: &ReconcilePlan,
    require_alias: bool,
    version: u64,
) -> Result<()> {
    let version = external_version(version, OpensearchOperation::ReconcileAgentSessionBulk)?;
    let mut body = Vec::with_capacity(plan.write.len() * 2 + plan.delete.len());
    for (id, document) in &plan.write {
        body.push(
            serde_json::to_string(&fenced_action("index", id, routing, version)).map_err(
                |error| serialization_error(OpensearchOperation::ReconcileAgentSessionBulk, error),
            )?,
        );
        body.push(document.clone());
    }
    for id in &plan.delete {
        body.push(
            serde_json::to_string(&fenced_action("delete", id, routing, version)).map_err(
                |error| serialization_error(OpensearchOperation::ReconcileAgentSessionBulk, error),
            )?,
        );
    }

    let response = client
        .bulk(BulkParts::Index(index))
        .require_alias(require_alias)
        .body(body)
        .send()
        .await
        .map_err(|error| {
            OpensearchClientError::request_failed(
                OpensearchOperation::ReconcileAgentSessionBulk,
                &error,
            )
        })?;
    if !response.status_code().is_success() {
        return response_error(response, OpensearchOperation::ReconcileAgentSessionBulk).await;
    }
    let response_body: serde_json::Value = response.json().await.map_err(|error| {
        OpensearchClientError::deserialization_failed(
            OpensearchOperation::ReconcileAgentSessionBulk,
            &error,
        )
    })?;
    if response_body["errors"].as_bool() == Some(true) {
        tracing::error!(body=?response_body, "agent-session bulk reconcile had failed items");
        return Err(OpensearchClientError::Unknown {
            details: response_body.to_string(),
            operation: OpensearchOperation::ReconcileAgentSessionBulk,
        });
    }
    Ok(())
}

/// Removes children neither the record nor this reconcile accounts for:
/// children written before parents kept records (older projections of
/// renumbered turns among them), and any a failed reconcile wrote without
/// recording. The search behind it sees only refreshed documents, so it skips
/// the ids this reconcile just wrote or deleted; a leftover younger than a
/// refresh goes on the next reconcile. The deletes carry this reconcile's
/// version, so a delayed sweep cannot remove a child a later reconcile wrote.
/// When nothing is left over, which is the normal case, it only searches.
async fn prune_unrecorded_children(
    client: &opensearch::OpenSearch,
    index: &str,
    args: &ReconcileAgentSessionArgs,
    plan: &ReconcilePlan,
) -> Result<usize> {
    let operation = OpensearchOperation::ReconcileAgentSessionPrune;
    let mut keep: Vec<&str> = plan.record.keys().map(String::as_str).collect();
    keep.extend(plan.delete.iter().map(String::as_str));
    keep.push(&args.agent_session_id);
    let leftovers =
        unrecorded_children(client, index, &args.agent_session_id, &keep, operation).await?;
    if !leftovers.is_empty() {
        delete_by_id(
            client,
            index,
            &args.agent_session_id,
            &leftovers,
            external_version(args.version, operation)?,
            operation,
        )
        .await?;
    }
    Ok(leftovers.len())
}

fn to_parent_value(parent: ParentDocument<'_>) -> Result<serde_json::Value> {
    serde_json::to_value(parent).map_err(|error| {
        serialization_error(OpensearchOperation::ReconcileAgentSessionParent, error)
    })
}

#[tracing::instrument(skip_all)]
async fn write_parent(
    client: &opensearch::OpenSearch,
    index: &str,
    args: &ReconcileAgentSessionArgs,
    parent: serde_json::Value,
    require_alias: bool,
) -> Result<()> {
    let operation = OpensearchOperation::ReconcileAgentSessionParent;
    let response = client
        .index(opensearch::IndexParts::IndexId(
            index,
            &args.agent_session_id,
        ))
        .routing(&args.agent_session_id)
        .require_alias(require_alias)
        .version(external_version(args.version, operation)?)
        .version_type(opensearch::params::VersionType::ExternalGte)
        .body(parent)
        .send()
        .await
        .map_err(|error| {
            OpensearchClientError::request_failed(
                OpensearchOperation::ReconcileAgentSessionParent,
                &error,
            )
        })?;
    response_error(response, OpensearchOperation::ReconcileAgentSessionParent).await
}

/// Write the messages that changed since the parent's record, remove the ones
/// the session no longer has, record the result on the parent, then sweep
/// children no record names. Callers serialize reconciles by session id. A
/// missing index or alias fails the first read, before any write or delete
/// could create one.
///
/// Nothing waits for a refresh: no caller reads the index back, and every
/// write and delete names its document by id, which needs no refresh to apply.
/// Every write and delete carries `args.version` as an `external_gte`
/// version, so a delayed request from an earlier reconcile cannot overwrite
/// what a later one wrote: the index refuses it.
/// While children change the parent names them pending, and it records them
/// only after they were written, so after a failed request the next reconcile
/// rewrites or deletes exactly what might differ, and the version covers a
/// request that times out here and applies later. The sweep comes last so a
/// failed sweep never leaves the parent's name or recency stale.
pub(crate) async fn reconcile_agent_session(
    client: &opensearch::OpenSearch,
    args: &ReconcileAgentSessionArgs,
    index_override: Option<&str>,
) -> Result<AgentSessionReconcileWrites> {
    let index = resolve_destination(index_override);
    let routing = args.agent_session_id.as_str();
    // Normal writes must never auto-create an index under the alias name.
    // Backfills may explicitly target a pre-provisioned physical index.
    let require_alias = index_override.is_none();

    let stored = stored_parent(client, index, routing).await?;
    let previous = stored.as_ref().and_then(|parent| parent.indexed_messages());
    let pending = stored
        .as_ref()
        .map(|parent| parent.pending_messages())
        .unwrap_or_default();
    let plan = plan(args, previous.as_ref(), &pending)?;

    // Before any child changes, the parent stops vouching for the children the
    // plan touches and names them pending, so a reconcile that fails part way
    // leaves them for the next one to rewrite or delete by id.
    if plan.touches_children() {
        let (untouched, touched) = plan.intent();
        write_parent(
            client,
            index,
            args,
            to_parent_value(parent_document(args, &untouched, &touched))?,
            require_alias,
        )
        .await?;
        write_children(client, index, routing, &plan, require_alias, args.version).await?;
    }

    let parent = to_parent_value(parent_document(args, &plan.record, &[]))?;
    let parent_written =
        plan.touches_children() || stored.as_ref().map(|stored| stored.source()) != Some(&parent);
    if parent_written {
        write_parent(client, index, args, parent, require_alias).await?;
    }
    let swept = prune_unrecorded_children(client, index, args, &plan).await?;

    Ok(AgentSessionReconcileWrites {
        parent_written,
        messages_written: plan.write.len(),
        messages_unchanged: plan.unchanged,
        messages_deleted: plan.delete.len() + swept,
    })
}
