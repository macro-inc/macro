//! Persisted coding context for the already-authorized agent rows in one page.

use std::collections::{HashMap, HashSet};

use agent_changes::domain::{
    model::{AgentSessionId, PullRequestRef},
    ports::SessionBranchReader,
};
use models_soup::agent_session::AgentPullRequestState;

use super::*;

const PULL_REQUEST_SOURCE: &str = "github_pull_request";

fn pull_request_key(url: &str) -> Option<String> {
    let reference = PullRequestRef::parse(url)?;
    Some(format!(
        "{}/pull/{}",
        reference.repository, reference.number
    ))
}

/// Enrich only returned rows, so metadata work is bounded by the page size and
/// never reads branch facts for sessions outside the caller's visible page.
pub(super) async fn enrich<F: ForeignEntityService>(
    foreign_entities: &F,
    branches: Option<&dyn SessionBranchReader>,
    user: String,
    sources: Vec<SourceId>,
    items: &mut [SoupCandidate],
) -> Result<(), SoupErr> {
    let sessions: Vec<_> = items
        .iter()
        .filter_map(|candidate| match &candidate.item {
            SoupItem::AgentSession(session) if session.working_branch.is_none() => {
                Some(AgentSessionId::new_from_uuid(session.id))
            }
            _ => None,
        })
        .collect();
    if !items
        .iter()
        .any(|candidate| matches!(candidate.item, SoupItem::AgentSession(_)))
    {
        return Ok(());
    }

    let keys: HashSet<_> = items
        .iter()
        .filter_map(|candidate| match &candidate.item {
            SoupItem::AgentSession(session) => session
                .pull_request_url
                .as_deref()
                .and_then(pull_request_key),
            _ => None,
        })
        .collect();

    let branch_facts = async {
        match branches {
            Some(reader) if !sessions.is_empty() => reader
                .working_branches(&sessions)
                .await
                .map_err(|error| anyhow::anyhow!("reading agent working branches: {error}")),
            _ => Ok(HashMap::new()),
        }
    };
    let pr_facts = async {
        let Some(ids) = balanced_or_tree(
            keys.iter()
                .cloned()
                .map(ForeignEntityLiteral::ForeignEntityId)
                .map(Expr::Literal)
                .collect(),
        ) else {
            return Ok(Vec::new());
        };
        let filter = Expr::and(
            Expr::Literal(ForeignEntityLiteral::ForeignEntitySource(
                PULL_REQUEST_SOURCE.to_owned(),
            )),
            Arc::unwrap_or_clone(ids),
        );
        foreign_entities
            .get_foreign_entities_for_user(
                Some(user),
                sources,
                keys.len() as u32,
                Query::new(None, SimpleSortMethod::UpdatedAt, Some(Arc::new(filter))),
            )
            .await
            .map_err(anyhow::Error::from)
    };
    let (branch_facts, pr_facts) = tokio::try_join!(branch_facts, pr_facts)?;
    let states: HashMap<_, (Uuid, Option<AgentPullRequestState>)> = pr_facts
        .into_iter()
        .map(|entity| {
            let state = entity
                .metadata
                .get("status")
                .and_then(|status| serde_json::from_value(status.clone()).ok());
            (entity.foreign_entity_id, (entity.id, state))
        })
        .collect();

    for candidate in items {
        let SoupItem::AgentSession(session) = &mut candidate.item else {
            continue;
        };
        if session.working_branch.is_none() {
            session.working_branch = branch_facts
                .get(&AgentSessionId::new_from_uuid(session.id))
                .and_then(|fact| fact.for_repository(session.repo_url.as_deref()?))
                .map(str::to_owned);
        }
        let pull_request = session
            .pull_request_url
            .as_deref()
            .and_then(pull_request_key)
            .and_then(|key| states.get(&key).copied());
        session.pull_request_id = pull_request.map(|(id, _)| id);
        session.pull_request_state = pull_request.and_then(|(_, state)| state);
    }
    Ok(())
}
