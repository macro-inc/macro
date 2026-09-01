//! PostgreSQL implementation of the AccessRepository trait.

mod queries;

pub use queries::{SourceIds, get_team_scope_source_ids, get_user_source_ids};

#[cfg(test)]
mod test;

use crate::domain::{
    models::{
        AccessError, AccessLevel, BotId, CallChannelInfo, ChannelRoleResult, CrmEntityAccess,
        EntityType, UserTeamInfo,
    },
    ports::AccessRepository,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

/// PostgreSQL-backed implementation of [`AccessRepository`].
///
/// Contains all SQL queries directly - no external crate dependencies.
#[derive(Clone)]
pub struct PgAccessRepository {
    pool: PgPool,
}

impl PgAccessRepository {
    /// Create a new PostgreSQL access repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn foreign_entity_source_pairs(
    user_id: &MacroUserId<Lowercase<'_>>,
    user_team: Option<UserTeamInfo>,
) -> (Vec<String>, Vec<String>) {
    let mut source_ids = vec![user_id.as_ref().to_string()];
    let mut source_auth_entities = vec!["user".to_string()];

    if let Some(user_team) = user_team {
        source_ids.push(user_team.team_id.to_string());
        source_auth_entities.push("team".to_string());
    }

    (source_ids, source_auth_entities)
}

fn team_foreign_entity_source_pairs(
    team_id: Uuid,
    bot_principal: &str,
) -> (Vec<String>, Vec<String>) {
    (
        vec![team_id.to_string(), bot_principal.to_string()],
        vec!["team".to_string(), "user".to_string()],
    )
}

impl AccessRepository for PgAccessRepository {
    #[tracing::instrument(err, skip(self))]
    async fn get_document_access(
        &self,
        document_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let document_uuid = document_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid document ID format"))?;
        let source_ids = queries::get_user_source_ids(&self.pool, user_id)
            .await
            .map_err(anyhow_access_error)?;
        Ok(queries::document_access::get_document_access(
            &self.pool,
            &document_uuid,
            &source_ids,
            user_id,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let chat_uuid = chat_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid chat ID format"))?;
        let source_ids = queries::get_user_source_ids(&self.pool, user_id)
            .await
            .map_err(anyhow_access_error)?;
        Ok(queries::chat_access::get_chat_access(&self.pool, &chat_uuid, &source_ids).await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_access(
        &self,
        project_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let project_uuid = project_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid project ID format"))?;
        let source_ids = queries::get_user_source_ids(&self.pool, user_id)
            .await
            .map_err(anyhow_access_error)?;
        Ok(
            queries::project_access::get_project_access(&self.pool, &project_uuid, &source_ids)
                .await?,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_access(
        &self,
        thread_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let thread_uuid = thread_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid thread ID format"))?;
        let source_ids = queries::get_user_source_ids(&self.pool, user_id)
            .await
            .map_err(anyhow_access_error)?;
        Ok(queries::thread_access::get_thread_access(
            &self.pool,
            &thread_uuid,
            &source_ids,
            user_id,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_calendar_event_access(
        &self,
        event_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let event_id = event_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid calendar event ID format"))?;
        let Some(user_id) = user_id else {
            return Ok(None);
        };
        let user_id = user_id.as_ref();
        let is_owner = sqlx::query_scalar!(
            r#"
            SELECT event.owner_id = $2 AS "is_owner!"
            FROM calendar_events event
            WHERE event.id = $1
              AND (
                  event.owner_id = $2
                  OR EXISTS (
                      SELECT 1
                      FROM macro_user_links link
                      WHERE link.link_id = event.source_link_id
                        AND link.primary_macro_id = $2
                  )
              )
            "#,
            event_id,
            user_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(AccessError::from)?;

        Ok(is_owner.map(|is_owner| {
            if is_owner {
                AccessLevel::Owner
            } else {
                AccessLevel::Edit
            }
        }))
    }

    #[tracing::instrument(err, skip(self, thread_ids, user_id))]
    async fn get_owned_email_thread_ids(
        &self,
        thread_ids: &[Uuid],
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<Uuid>, AccessError> {
        Ok(
            queries::thread_access::get_owned_email_thread_ids(&self.pool, thread_ids, user_id)
                .await?,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_access(
        &self,
        call_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let call_uuid = call_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid call ID format"))?;
        let source_ids = queries::get_user_source_ids(&self.pool, user_id)
            .await
            .map_err(anyhow_access_error)?;
        Ok(queries::call_access::get_call_access(&self.pool, &call_uuid, &source_ids).await?)
    }

    async fn get_agent_session_access(
        &self,
        agent_session_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let agent_session_uuid = agent_session_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid agent session ID format"))?;
        let source_ids = queries::get_user_source_ids(&self.pool, user_id)
            .await
            .map_err(anyhow_access_error)?;
        Ok(queries::agent_session_access::get_agent_session_access(
            &self.pool,
            &agent_session_uuid,
            &source_ids,
        )
        .await?)
    }

    // A macro user id embeds the user's email, so it stays out of the span; the
    // reminder id is what identifies the lookup anyway.
    #[tracing::instrument(err, skip(self, user_id))]
    async fn get_reminder_access(
        &self,
        reminder_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let reminder_uuid = reminder_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid reminder ID format"))?;
        // An anonymous caller can never own a reminder, so skip the query.
        let Some(user_id) = user_id else {
            return Ok(None);
        };

        let owns = sqlx::query_scalar!(
            r#"SELECT EXISTS (
                   SELECT 1 FROM reminder WHERE id = $1 AND user_id = $2
               ) AS "owns!""#,
            reminder_uuid,
            user_id.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(AccessError::from)?;

        // Owner or nothing: a reminder has no sharing model to grade.
        Ok(owns.then_some(AccessLevel::Owner))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_entity_access(
        &self,
        bot_id: BotId,
        team_id: Uuid,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let entity_uuid = entity_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid entity ID format"))?;
        let bot_principal = bot_id.into_storage_id();
        let source_ids = queries::get_team_scope_source_ids(&self.pool, &bot_principal, &team_id)
            .await
            .map_err(anyhow_access_error)?;

        let access = match entity_type {
            EntityType::Document => {
                queries::document_access::get_document_access(
                    &self.pool,
                    &entity_uuid,
                    &source_ids,
                    None,
                )
                .await
            }
            EntityType::Chat => {
                queries::chat_access::get_chat_access(&self.pool, &entity_uuid, &source_ids).await
            }
            EntityType::Project => {
                queries::project_access::get_project_access(&self.pool, &entity_uuid, &source_ids)
                    .await
            }
            EntityType::EmailThread => {
                queries::thread_access::get_thread_access(
                    &self.pool,
                    &entity_uuid,
                    &source_ids,
                    None,
                )
                .await
            }
            EntityType::Call => {
                queries::call_access::get_call_access(&self.pool, &entity_uuid, &source_ids).await
            }
            EntityType::AgentSession => {
                queries::agent_session_access::get_agent_session_access(
                    &self.pool,
                    &entity_uuid,
                    &source_ids,
                )
                .await
            }
            EntityType::User
            | EntityType::Channel
            | EntityType::ChannelMessage
            | EntityType::CalendarEvent
            | EntityType::Team
            | EntityType::ForeignEntity
            | EntityType::StaticFile
            | EntityType::CrmCompany
            | EntityType::CrmContact
            | EntityType::Skill
            // Reminders are user-owned, never reachable through a team scope.
            | EntityType::Reminder => {
                return Err(AccessError::BadRequest(
                    "Unsupported entity type for team item access",
                ));
            }
        };

        access.map_err(AccessError::from)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_channel_role(
        &self,
        channel_id: &Uuid,
        team_id: Uuid,
        bot_id: BotId,
    ) -> Result<ChannelRoleResult, AccessError> {
        let bot_principal = bot_id.into_storage_id();
        Ok(queries::channel_role::get_team_channel_role(
            &self.pool,
            channel_id,
            &team_id,
            &bot_principal,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn has_team_foreign_entity_access(
        &self,
        foreign_entity_id: &str,
        team_id: Uuid,
        bot_id: BotId,
    ) -> Result<bool, AccessError> {
        let foreign_entity_uuid = foreign_entity_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid foreign entity ID format"))?;
        let bot_principal = bot_id.into_storage_id();
        let scope_sources =
            queries::get_team_scope_source_ids(&self.pool, &bot_principal, &team_id)
                .await
                .map_err(anyhow_access_error)?;

        if !scope_sources.0.contains(&team_id.to_string())
            || !scope_sources.0.contains(&bot_principal.to_string())
        {
            return Ok(false);
        }

        let (source_ids, source_auth_entities) =
            team_foreign_entity_source_pairs(team_id, bot_principal.as_ref());
        Ok(queries::foreign_entity_access::has_foreign_entity_access(
            &self.pool,
            &foreign_entity_uuid,
            &source_ids,
            &source_auth_entities,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_crm_company_access(
        &self,
        company_id: &str,
        team_id: Uuid,
    ) -> Result<Option<CrmEntityAccess>, AccessError> {
        let company_uuid = company_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid CRM company ID format"))?;
        Ok(queries::crm_company_access::get_team_crm_company_access(
            &self.pool,
            &company_uuid,
            &team_id,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_crm_contact_access(
        &self,
        contact_id: &str,
        team_id: Uuid,
    ) -> Result<Option<CrmEntityAccess>, AccessError> {
        let contact_uuid = contact_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid CRM contact ID format"))?;
        Ok(queries::crm_contact_access::get_team_crm_contact_access(
            &self.pool,
            &contact_uuid,
            &team_id,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn has_foreign_entity_access(
        &self,
        foreign_entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<bool, AccessError> {
        let foreign_entity_uuid = foreign_entity_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid foreign entity ID format"))?;

        let Some(user_id) = user_id else {
            return Ok(false);
        };

        let user_team = queries::team_access::get_user_team(&self.pool, user_id).await?;
        let (source_ids, source_auth_entities) = foreign_entity_source_pairs(user_id, user_team);

        Ok(queries::foreign_entity_access::has_foreign_entity_access(
            &self.pool,
            &foreign_entity_uuid,
            &source_ids,
            &source_auth_entities,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_crm_company_access(
        &self,
        company_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<CrmEntityAccess>, AccessError> {
        let company_uuid = company_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid CRM company ID format"))?;
        let Some(user_id) = user_id else {
            return Ok(None);
        };
        Ok(
            queries::crm_company_access::get_crm_company_access(&self.pool, &company_uuid, user_id)
                .await?,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_crm_contact_access(
        &self,
        contact_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<CrmEntityAccess>, AccessError> {
        let contact_uuid = contact_id
            .parse::<Uuid>()
            .map_err(|_| AccessError::BadRequest("Invalid CRM contact ID format"))?;
        let Some(user_id) = user_id else {
            return Ok(None);
        };
        Ok(
            queries::crm_contact_access::get_crm_contact_access(&self.pool, &contact_uuid, user_id)
                .await?,
        )
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_user_channel_membership(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        channel_ids: &[Uuid],
    ) -> Result<Vec<Uuid>, AccessError> {
        Ok(queries::channel_membership::check_user_channel_membership(
            &self.pool,
            user_id,
            channel_ids,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_role(
        &self,
        channel_id: &Uuid,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        user_org_id: Option<i64>,
    ) -> Result<ChannelRoleResult, AccessError> {
        Ok(queries::channel_role::get_channel_role(
            &self.pool,
            channel_id,
            user_id.map(AsRef::as_ref).unwrap_or(""),
            user_org_id,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_entity_users(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        queries::get_entity_users(&self.pool, entity_id, entity_type)
            .await
            .map_err(anyhow_access_error)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_users(
        &self,
        channel_id: &Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        queries::channel_users::get_channel_users(&self.pool, channel_id)
            .await
            .map_err(AccessError::from)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_channel(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        let row = queries::call_channel::get_call_channel(&self.pool, call_id).await?;
        Ok(row.map(|r| CallChannelInfo {
            channel_id: r.channel_id,
            share_permission_id: r.share_permission_id,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_channel_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        let row =
            queries::call_channel::get_call_channel_by_channel_id(&self.pool, channel_id).await?;
        Ok(row.map(|r| CallChannelInfo {
            channel_id: r.channel_id,
            share_permission_id: r.share_permission_id,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(queries::team_access::get_user_team(&self.pool, user_id).await?)
    }
}

/// Classify an anyhow-wrapped query failure by downcasting to the sqlx error
/// when there is one, so genuine database outages surface as `Unavailable`
/// instead of hiding in `Internal`.
fn anyhow_access_error(e: anyhow::Error) -> AccessError {
    match e.downcast::<sqlx::Error>() {
        Ok(sqlx_error) => AccessError::from(sqlx_error),
        Err(other) => AccessError::Internal(rootcause::report!(other).into_dynamic()),
    }
}

// The domain error stays sqlx-free; this adapter owns the classification,
// where the error is still concrete: connection-level failures (and Postgres
// serialization/deadlock aborts, which are safe to retry) are `Unavailable`;
// everything else is a bug or bad data, so retrying won't help. The raw sqlx
// error travels inside the report, so nothing is lost from the logs.
impl From<sqlx::Error> for AccessError {
    fn from(e: sqlx::Error) -> Self {
        let transient = matches!(
            &e,
            sqlx::Error::PoolTimedOut
                | sqlx::Error::PoolClosed
                | sqlx::Error::WorkerCrashed
                | sqlx::Error::Io(_)
                | sqlx::Error::Tls(_)
        ) || matches!(
            &e,
            sqlx::Error::Database(db)
                if matches!(db.code().as_deref(), Some("40001") | Some("40P01"))
        );
        let report = rootcause::report!(e).into_dynamic();
        if transient {
            Self::Unavailable(report)
        } else {
            Self::Internal(report)
        }
    }
}
