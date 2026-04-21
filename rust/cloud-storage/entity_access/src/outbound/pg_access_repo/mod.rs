//! PostgreSQL implementation of the AccessRepository trait.

mod queries;

use crate::domain::{
    models::{AccessError, AccessLevel, CallChannelInfo, ChannelRoleResult, EntityType},
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
            .map_err(|_| AccessError::Internal)?;
        Ok(
            queries::document_access::get_document_access(&self.pool, &document_uuid, &source_ids)
                .await?,
        )
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
            .map_err(|_| AccessError::Internal)?;
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
            .map_err(|_| AccessError::Internal)?;
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
            .map_err(|_| AccessError::Internal)?;
        Ok(queries::thread_access::get_thread_access(
            &self.pool,
            &thread_uuid,
            &source_ids,
            user_id,
        )
        .await?)
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
            .map_err(|_| AccessError::Internal)?;
        Ok(queries::call_access::get_call_access(&self.pool, &call_uuid, &source_ids).await?)
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
            .map_err(|_| AccessError::Internal)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_users(
        &self,
        channel_id: &Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        queries::channel_users::get_channel_users(&self.pool, channel_id)
            .await
            .map_err(|_| AccessError::Internal)
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
}
