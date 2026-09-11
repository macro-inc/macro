//! Resolve who a prompt mentions through the lexical service, and share the
//! session with them.
//!
//! The lexical service is the one place that parses Macro markdown, so the
//! `<m-user-mention>` tags come from its `/mentions` endpoint - the same call
//! channel messages use to track theirs. Access is the session's
//! `entity_access` grants: the owner, the origin channel's members, any team,
//! and - after this - whoever an editor has mentioned.

#[cfg(test)]
mod test;

use std::future::Future;
use std::pin::Pin;

use agent_session::domain::model::AgentSessionId;
use entity_access::domain::models::{AccessLevel, EntityType};
use entity_access::domain::ports::AccessRepository;
use entity_access::outbound::PgAccessRepository;
use lexical_client::LexicalClient;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

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

/// Who may open a session, and the door to let more people in.
pub(crate) trait SessionAccess: Send + Sync + 'static {
    /// Everyone who can open `session_id`.
    fn viewers(
        &self,
        session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>>> + Send;

    /// The highest access `user` has on `session_id`, if any.
    fn access_of(
        &self,
        session_id: AgentSessionId,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<AccessLevel>>> + Send;

    /// Let each of `users` edit `session_id`. Never lowers anyone: a user who
    /// already holds access keeps what they have.
    fn grant_edit(
        &self,
        session_id: AgentSessionId,
        users: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<()>> + Send;
}

/// [`SessionAccess`] over the `entity_access` table, read through the access
/// repository and written through the shared `entity_access_db_utils`.
pub struct PgSessionAccess {
    access: PgAccessRepository,
    pool: PgPool,
}

impl PgSessionAccess {
    /// Read and write grants through `pool`.
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self {
            access: PgAccessRepository::new(pool.clone()),
            pool,
        }
    }
}

impl SessionAccess for PgSessionAccess {
    async fn viewers(&self, session_id: AgentSessionId) -> Result<Vec<MacroUserIdStr<'static>>> {
        self.access
            .get_entity_users(&session_id.as_uuid(), EntityType::AgentSession)
            .await
            .map_err(|error| HarnessError::Mentions(rootcause::report!(error).into()))
    }

    async fn access_of(
        &self,
        session_id: AgentSessionId,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<AccessLevel>> {
        self.access
            .get_agent_session_access(&session_id.as_uuid().to_string(), Some(&user.0))
            .await
            .map_err(|error| HarnessError::Mentions(rootcause::report!(error).into()))
    }

    async fn grant_edit(
        &self,
        session_id: AgentSessionId,
        users: &[MacroUserIdStr<'static>],
    ) -> Result<()> {
        // The shared writer for direct user grants: it never touches an
        // owner row, and edit is the most anyone else can hold, so nobody is
        // lowered.
        entity_access_db_utils::upsert_user_entity_access_bulk(
            &self.pool,
            users,
            &session_id.as_uuid(),
            EntityType::AgentSession,
            AccessLevel::Edit,
        )
        .await
        .map_err(|error| HarnessError::Mentions(rootcause::report!(error).into()))
    }
}

/// [`PromptMentions`] over the lexical service and the session's grants.
pub struct LexicalPromptMentions<Source, Access> {
    source: Source,
    access: Access,
}

impl<Source, Access> LexicalPromptMentions<Source, Access> {
    /// Parse with `source`, read and grant through `access`.
    pub fn new(source: Source, access: Access) -> Self {
        Self { source, access }
    }
}

impl<Source, Access> PromptMentions for LexicalPromptMentions<Source, Access>
where
    Source: MentionSource,
    Access: SessionAccess,
{
    fn share_with_mentioned<'a>(
        &'a self,
        session_id: AgentSessionId,
        actor: Option<&'a MacroUserIdStr<'static>>,
        prompt_markdown: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<MacroUserIdStr<'static>>>> + Send + 'a>> {
        Box::pin(async move {
            let mentioned = self.source.mentioned_user_ids(prompt_markdown).await?;
            let mut users: Vec<MacroUserIdStr<'static>> = Vec::new();
            for id in mentioned {
                // An id the lexical service produced that is not a Macro user
                // id is not ours to notify; skip it rather than fail the lot.
                let Ok(user) = MacroUserIdStr::parse_from_str(&id) else {
                    tracing::warn!(mention = %id, "ignoring a user mention that is not a macro user id");
                    continue;
                };
                let user = user.into_owned();
                if actor != Some(&user) && !users.contains(&user) {
                    users.push(user);
                }
            }
            if users.is_empty() {
                return Ok(users);
            }

            // Only someone who can drive the session may let others in; a
            // prompt with no user behind it, or from a viewer, amplifies
            // nobody.
            let actor_may_share = match actor {
                Some(actor) => {
                    self.access.access_of(session_id, actor).await? >= Some(AccessLevel::Edit)
                }
                None => false,
            };
            if actor_may_share {
                self.access.grant_edit(session_id, &users).await?;
                return Ok(users);
            }
            let viewers = self.access.viewers(session_id).await?;
            users.retain(|user| viewers.contains(user));
            Ok(users)
        })
    }
}
