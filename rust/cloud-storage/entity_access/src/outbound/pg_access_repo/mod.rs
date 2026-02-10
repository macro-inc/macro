//! PostgreSQL implementation of the AccessRepository trait.

mod queries;

use crate::domain::{
    models::{AccessError, AccessLevel, ChannelRoleResult},
    ports::AccessRepository,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
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
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(queries::document_access::get_document_access(&self.pool, document_id, user_id).await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(queries::chat_access::get_chat_access(&self.pool, chat_id, user_id).await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_access(
        &self,
        project_id: &str,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(queries::project_access::get_project_access(&self.pool, project_id, user_id).await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_access(
        &self,
        thread_id: &str,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(queries::thread_access::get_thread_access(&self.pool, thread_id, user_id).await?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_user_channel_membership(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
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
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
    ) -> Result<ChannelRoleResult, AccessError> {
        Ok(queries::channel_role::get_channel_role(
            &self.pool,
            channel_id,
            user_id.as_ref(),
            user_org_id,
        )
        .await?)
    }
}
