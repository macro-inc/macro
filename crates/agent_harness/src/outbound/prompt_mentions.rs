//! Resolve who a prompt mentions through the lexical service, narrowed to
//! the people who can open the session.
//!
//! The lexical service is the one place that parses Macro markdown, so the
//! `<m-user-mention>` tags come from its `/mentions` endpoint - the same call
//! channel messages use to track theirs. Access comes from the session's
//! `entity_access` grants: the owner, the origin channel's members, any team.

#[cfg(test)]
mod test;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use agent_session::domain::model::AgentSessionId;
use entity_access::domain::models::EntityType;
use entity_access::domain::ports::AccessRepository;
use lexical_client::LexicalClient;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::PromptMentions;

/// The wire name the lexical service gives a user mention.
const USER_MENTION_TYPE: &str = "user";

/// Extracts the user ids a markdown string mentions.
pub(crate) trait MentionSource: Send + Sync + 'static {
    fn mentioned_user_ids(
        &self,
        markdown: &str,
    ) -> impl Future<Output = Result<Vec<String>>> + Send;
}

impl MentionSource for LexicalClient {
    async fn mentioned_user_ids(&self, markdown: &str) -> Result<Vec<String>> {
        let mentions = self
            .extract_mentions(markdown)
            .await
            .map_err(|error| HarnessError::Mentions(rootcause::report!(error).into()))?;
        Ok(mentions
            .into_iter()
            .filter(|mention| mention.entity_type == USER_MENTION_TYPE)
            .map(|mention| mention.entity_id)
            .collect())
    }
}

/// Lists who may open a session.
pub(crate) trait SessionViewers: Send + Sync + 'static {
    fn viewers(
        &self,
        session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>>> + Send;
}

impl<Access> SessionViewers for Access
where
    Access: AccessRepository,
{
    async fn viewers(&self, session_id: AgentSessionId) -> Result<Vec<MacroUserIdStr<'static>>> {
        self.get_entity_users(&session_id.as_uuid(), EntityType::AgentSession)
            .await
            .map_err(|error| HarnessError::Mentions(rootcause::report!(error).into()))
    }
}

/// [`PromptMentions`] over the lexical service and the access repository.
pub struct LexicalPromptMentions<Source, Access> {
    source: Source,
    access: Arc<Access>,
}

impl<Source, Access> LexicalPromptMentions<Source, Access> {
    /// Parse with `source`, gate on `access`.
    pub fn new(source: Source, access: Arc<Access>) -> Self {
        Self { source, access }
    }
}

impl<Source, Access> PromptMentions for LexicalPromptMentions<Source, Access>
where
    Source: MentionSource,
    Access: SessionViewers,
{
    fn mentioned_users<'a>(
        &'a self,
        session_id: AgentSessionId,
        prompt_markdown: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<MacroUserIdStr<'static>>>> + Send + 'a>> {
        Box::pin(async move {
            let mentioned = self.source.mentioned_user_ids(prompt_markdown).await?;
            if mentioned.is_empty() {
                return Ok(Vec::new());
            }
            let viewers = self.access.viewers(session_id).await?;
            let mut users: Vec<MacroUserIdStr<'static>> = Vec::new();
            for id in mentioned {
                // An id the lexical service produced that is not a Macro user
                // id is not ours to notify; skip it rather than fail the lot.
                let Ok(user) = MacroUserIdStr::parse_from_str(&id) else {
                    tracing::warn!(mention = %id, "ignoring a user mention that is not a macro user id");
                    continue;
                };
                let user = user.into_owned();
                if viewers.contains(&user) && !users.contains(&user) {
                    users.push(user);
                }
            }
            Ok(users)
        })
    }
}
