use crate::domain::{
    models::{AccessError, AccessGrant, EntityType, ForeignEntityAuthEntity, UserTeamInfo},
    ports::ExplainAccessRepository,
};
use crate::outbound::pg_access_repo::queries;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

/// PostgreSQL-backed implementation of [`ExplainAccessRepository`].
#[derive(Clone)]
pub struct PgExplainAccessRepository {
    pool: PgPool,
}

impl PgExplainAccessRepository {
    /// Create a new explain repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn foreign_entity_source_pairs(
    user_id: &MacroUserId<Lowercase<'_>>,
    user_team: Option<UserTeamInfo>,
) -> (Vec<String>, Vec<String>) {
    let mut source_ids = vec![user_id.as_ref().to_string()];
    let mut source_auth_entities = vec![ForeignEntityAuthEntity::User.as_str().to_string()];

    if let Some(user_team) = user_team {
        source_ids.push(user_team.team_id.to_string());
        source_auth_entities.push(ForeignEntityAuthEntity::Team.as_str().to_string());
    }

    (source_ids, source_auth_entities)
}

fn parse_uuid(entity_id: &str, message: &'static str) -> Result<Uuid, AccessError> {
    Uuid::parse_str(entity_id).map_err(|_| AccessError::BadRequest(message))
}

impl ExplainAccessRepository for PgExplainAccessRepository {
    #[tracing::instrument(err, skip(self))]
    async fn list_access_grants(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<AccessGrant>, AccessError> {
        match entity_type {
            EntityType::Document => {
                let document_id = parse_uuid(entity_id, "Invalid document ID format")?;
                let source_ids = queries::get_user_source_ids(&self.pool, Some(user_id))
                    .await
                    .map_err(anyhow_access_error)?;
                Ok(queries::document_access::explain_document_access(
                    &self.pool,
                    &document_id,
                    &source_ids,
                    Some(user_id),
                )
                .await?)
            }
            EntityType::Chat => {
                let chat_id = parse_uuid(entity_id, "Invalid chat ID format")?;
                let source_ids = queries::get_user_source_ids(&self.pool, Some(user_id))
                    .await
                    .map_err(anyhow_access_error)?;
                Ok(
                    queries::chat_access::explain_chat_access(&self.pool, &chat_id, &source_ids)
                        .await?,
                )
            }
            EntityType::Project => {
                let project_id = parse_uuid(entity_id, "Invalid project ID format")?;
                let source_ids = queries::get_user_source_ids(&self.pool, Some(user_id))
                    .await
                    .map_err(anyhow_access_error)?;
                Ok(queries::project_access::explain_project_access(
                    &self.pool,
                    &project_id,
                    &source_ids,
                )
                .await?)
            }
            EntityType::EmailThread => {
                let thread_id = parse_uuid(entity_id, "Invalid thread ID format")?;
                let source_ids = queries::get_user_source_ids(&self.pool, Some(user_id))
                    .await
                    .map_err(anyhow_access_error)?;
                Ok(queries::thread_access::explain_thread_access(
                    &self.pool,
                    &thread_id,
                    &source_ids,
                    Some(user_id),
                )
                .await?)
            }
            EntityType::Call => {
                let call_id = parse_uuid(entity_id, "Invalid call ID format")?;
                let source_ids = queries::get_user_source_ids(&self.pool, Some(user_id))
                    .await
                    .map_err(anyhow_access_error)?;
                Ok(
                    queries::call_access::explain_call_access(&self.pool, &call_id, &source_ids)
                        .await?,
                )
            }
            EntityType::AgentSession => {
                let session_id = parse_uuid(entity_id, "Invalid agent session ID format")?;
                let source_ids = queries::get_user_source_ids(&self.pool, Some(user_id))
                    .await
                    .map_err(anyhow_access_error)?;
                Ok(queries::agent_session_access::explain_agent_session_access(
                    &self.pool,
                    &session_id,
                    &source_ids,
                )
                .await?)
            }
            EntityType::Channel => {
                let channel_id = parse_uuid(entity_id, "Invalid channel ID format")?;
                Ok(queries::channel_role::explain_channel_access(
                    &self.pool,
                    &channel_id,
                    user_id.as_ref(),
                )
                .await?)
            }
            EntityType::CrmCompany => {
                let company_id = parse_uuid(entity_id, "Invalid CRM company ID format")?;
                Ok(queries::crm_company_access::get_crm_company_access(
                    &self.pool,
                    &company_id,
                    user_id,
                )
                .await?
                .map(|access| AccessGrant::CrmTeam {
                    team_id: access.team_id,
                    team_role: access.team_role,
                    access_level: access.access_level,
                })
                .into_iter()
                .collect())
            }
            EntityType::CrmContact => {
                let contact_id = parse_uuid(entity_id, "Invalid CRM contact ID format")?;
                Ok(queries::crm_contact_access::get_crm_contact_access(
                    &self.pool,
                    &contact_id,
                    user_id,
                )
                .await?
                .map(|access| AccessGrant::CrmTeam {
                    team_id: access.team_id,
                    team_role: access.team_role,
                    access_level: access.access_level,
                })
                .into_iter()
                .collect())
            }
            EntityType::Team => {
                let team_id = parse_uuid(entity_id, "Invalid team ID format")?;
                Ok(queries::team_access::get_user_team(&self.pool, user_id)
                    .await?
                    .filter(|team| team.team_id == team_id)
                    .map(|team| AccessGrant::TeamMembership { role: team.role })
                    .into_iter()
                    .collect())
            }
            EntityType::Reminder => {
                let reminder_id = parse_uuid(entity_id, "Invalid reminder ID format")?;
                explain_reminder_access(&self.pool, &reminder_id, user_id).await
            }
            EntityType::CalendarEvent => {
                let event_id = parse_uuid(entity_id, "Invalid calendar event ID format")?;
                explain_calendar_event_access(&self.pool, &event_id, user_id).await
            }
            EntityType::ForeignEntity => {
                let foreign_entity_id = parse_uuid(entity_id, "Invalid foreign entity ID format")?;
                let user_team = queries::team_access::get_user_team(&self.pool, user_id).await?;
                let (source_ids, source_auth_entities) =
                    foreign_entity_source_pairs(user_id, user_team);
                Ok(queries::foreign_entity_access::list_foreign_entity_grants(
                    &self.pool,
                    &foreign_entity_id,
                    &source_ids,
                    &source_auth_entities,
                )
                .await?)
            }
            EntityType::StaticFile => Ok(vec![AccessGrant::StaticFileAlwaysView]),
            EntityType::User | EntityType::ChannelMessage | EntityType::Skill => Ok(vec![]),
        }
    }
}

async fn explain_reminder_access(
    pool: &PgPool,
    reminder_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, AccessError> {
    let owns = sqlx::query_scalar!(
        r#"SELECT EXISTS (
               SELECT 1 FROM reminder WHERE id = $1 AND user_id = $2
           ) AS "owns!""#,
        reminder_id,
        user_id.as_ref(),
    )
    .fetch_one(pool)
    .await?;

    Ok(owns
        .then_some(AccessGrant::ReminderOwner)
        .into_iter()
        .collect())
}

async fn explain_calendar_event_access(
    pool: &PgPool,
    event_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, AccessError> {
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
        user_id.as_ref(),
    )
    .fetch_optional(pool)
    .await?;

    Ok(is_owner
        .map(|is_owner| {
            if is_owner {
                AccessGrant::CalendarOwner
            } else {
                AccessGrant::CalendarInboxDelegate
            }
        })
        .into_iter()
        .collect())
}

fn anyhow_access_error(e: anyhow::Error) -> AccessError {
    match e.downcast::<sqlx::Error>() {
        Ok(sqlx_error) => AccessError::from(sqlx_error),
        Err(other) => AccessError::Internal(rootcause::report!(other).into_dynamic()),
    }
}
