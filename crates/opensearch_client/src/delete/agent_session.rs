use models_opensearch::SearchIndex;

use crate::{
    Result,
    agent_session::{SWEEP_LIMIT, delete_by_id, stored_parent, unrecorded_children},
    error::{OpensearchClientError, OpensearchOperation},
    upsert::agent_session::external_version,
};

/// Remove a session parent and all of its message children.
///
/// The children the parent's record names or holds pending go first, by id,
/// which applies before any refresh. A search then finds the rest, such as
/// children written before parents kept records, and deletes them by id too.
/// The parent goes last, and stays when the search may have more to find, so a
/// retry after any failure still finds the survivors. Every delete carries `version`, so a delayed
/// delete from an earlier reconcile cannot remove what a later one wrote.
pub(crate) async fn delete_agent_session(
    client: &opensearch::OpenSearch,
    agent_session_id: &str,
    index_override: Option<&str>,
    version: u64,
) -> Result<()> {
    let index = index_override.unwrap_or(SearchIndex::AgentSessions.as_ref());
    let operation = OpensearchOperation::DeleteAgentSession;
    let version = external_version(version, operation)?;

    let stored = stored_parent(client, index, agent_session_id).await?;
    let mut children: Vec<String> = stored
        .as_ref()
        .and_then(|parent| parent.indexed_messages())
        .map(|record| record.into_keys().collect())
        .unwrap_or_default();
    for id in stored
        .as_ref()
        .map(|parent| parent.pending_messages())
        .unwrap_or_default()
    {
        if !children.contains(&id) {
            children.push(id);
        }
    }
    if !children.is_empty() {
        delete_by_id(
            client,
            index,
            agent_session_id,
            &children,
            version,
            operation,
        )
        .await?;
    }

    let mut keep: Vec<&str> = children.iter().map(String::as_str).collect();
    keep.push(agent_session_id);
    let leftovers = unrecorded_children(client, index, agent_session_id, &keep, operation).await?;
    if !leftovers.is_empty() {
        delete_by_id(
            client,
            index,
            agent_session_id,
            &leftovers,
            version,
            operation,
        )
        .await?;
    }
    if leftovers.len() >= SWEEP_LIMIT {
        return Err(OpensearchClientError::Unknown {
            details: format!("swept {SWEEP_LIMIT} children; the retry deletes the rest"),
            operation,
        });
    }

    delete_by_id(
        client,
        index,
        agent_session_id,
        &[agent_session_id.to_owned()],
        version,
        operation,
    )
    .await
}
