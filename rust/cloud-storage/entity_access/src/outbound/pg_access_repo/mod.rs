//! PostgreSQL implementation of the AccessRepository trait.

mod queries;

use crate::domain::{
    models::{AccessError, AccessLevel},
    ports::AccessRepository,
};
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
        user_id: &str,
    ) -> Result<Option<AccessLevel>, AccessError> {
        queries::document_access::get_document_access(&self.pool, document_id, user_id)
            .await
            .map_err(|e| AccessError::DatabaseError(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: &str,
    ) -> Result<Option<AccessLevel>, AccessError> {
        queries::chat_access::get_chat_access(&self.pool, chat_id, user_id)
            .await
            .map_err(|e| AccessError::DatabaseError(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_access(
        &self,
        project_id: &str,
        user_id: &str,
    ) -> Result<Option<AccessLevel>, AccessError> {
        queries::project_access::get_project_access(&self.pool, project_id, user_id)
            .await
            .map_err(|e| AccessError::DatabaseError(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_access(
        &self,
        thread_id: &str,
        user_id: &str,
    ) -> Result<Option<AccessLevel>, AccessError> {
        queries::thread_access::get_thread_access(&self.pool, thread_id, user_id)
            .await
            .map_err(|e| AccessError::DatabaseError(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_user_channel_membership(
        &self,
        user_id: &str,
        channel_ids: &[Uuid],
    ) -> Result<Vec<Uuid>, AccessError> {
        queries::channel_membership::check_user_channel_membership(&self.pool, user_id, channel_ids)
            .await
            .map_err(|e| AccessError::DatabaseError(e.into()))
    }
}
