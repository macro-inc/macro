//! Map authorized session metadata and folded message matches into API results.

use indexmap::IndexMap;
use macro_user_id::user_id::MacroUserId;
use models_search::agent_session::{AgentSessionSearchResponseItem, AgentSessionSearchResult};
use opensearch_client::search::model::{SearchGotoContent, SearchHit};

use crate::api::{context::SearchHandlerState, search::simple::SearchError};

pub(super) async fn enrich_agent_sessions(
    ctx: &SearchHandlerState,
    user_id: &str,
    hits: Vec<SearchHit>,
) -> Result<Vec<AgentSessionSearchResponseItem>, SearchError> {
    if hits.is_empty() {
        return Ok(Vec::new());
    }
    let user = MacroUserId::parse_from_str(user_id)
        .map_err(|_| SearchError::InvalidUserId(user_id.to_owned()))?
        .lowercase();
    let ids: Vec<_> = hits.iter().map(|hit| hit.entity_id).collect();
    let sessions = ctx
        .agent_session_search()
        .scope(&user, &ids, &[], true, false)
        .await
        .map_err(|error| SearchError::InternalError(anyhow::anyhow!("{error}")))?;
    let mut results: IndexMap<_, _> = sessions
        .into_iter()
        .map(|session| {
            (
                session.id,
                AgentSessionSearchResponseItem {
                    id: session.id,
                    name: session.name,
                    owner_id: session.owner_id.to_string(),
                    bot_id: session.bot_id,
                    created_at: session.created_at,
                    updated_at: session.updated_at,
                    agent_session_search_results: Vec::new(),
                },
            )
        })
        .collect();
    for hit in hits {
        if let Some(session) = results.get_mut(&hit.entity_id) {
            let goto = match hit.goto {
                Some(SearchGotoContent::AgentSessions(goto)) => Some(goto.into()),
                _ => None,
            };
            session
                .agent_session_search_results
                .push(AgentSessionSearchResult {
                    goto,
                    highlight: hit.highlight.into(),
                    score: hit.score,
                });
        }
    }
    Ok(results.into_values().collect())
}
