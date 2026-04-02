//! PostgreSQL implementation of the AccessRepository trait.

mod queries;

use crate::domain::{
    models::{AccessError, AccessLevel, CallChannelInfo, ChannelRoleResult},
    ports::AccessRepository,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

/// Convert a list of user ID strings from the database into typed [`MacroUserIdStr`] values.
///
/// Invalid user IDs are silently filtered out to avoid failing the entire query
/// due to a single malformed row.
fn parse_user_ids(raw: Vec<String>) -> Vec<MacroUserIdStr<'static>> {
    raw.into_iter()
        .filter_map(|s| MacroUserIdStr::try_from(s).ok())
        .collect()
}

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
        Ok(queries::document_access::get_document_access(&self.pool, document_id, user_id).await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(queries::chat_access::get_chat_access(&self.pool, chat_id, user_id).await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_access(
        &self,
        project_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(queries::project_access::get_project_access(&self.pool, project_id, user_id).await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_access(
        &self,
        thread_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(queries::thread_access::get_thread_access(&self.pool, thread_id, user_id).await?)
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
    async fn get_document_users(
        &self,
        document_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        let raw = queries::document_users::get_document_users(&self.pool, document_id).await?;
        Ok(parse_user_ids(raw))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat_users(
        &self,
        chat_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        let raw = queries::chat_users::get_chat_users(&self.pool, chat_id).await?;
        Ok(parse_user_ids(raw))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_users(
        &self,
        project_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        let raw = queries::project_users::get_project_users(&self.pool, project_id).await?;
        Ok(parse_user_ids(raw))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_users(
        &self,
        thread_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        let raw = queries::thread_users::get_thread_users(&self.pool, thread_id).await?;
        Ok(parse_user_ids(raw))
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
