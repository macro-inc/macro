//! PostgreSQL implementation of the AccessRepo trait.

use crate::domain::{
    models::{AccessLevel, ChannelPermission, SharePermissionInfo},
    ports::AccessRepo,
};
use sqlx::PgPool;
use std::str::FromStr;
use uuid::Uuid;

/// PostgreSQL-backed implementation of [`AccessRepo`].
///
/// Delegates to `macro_db_client` functions for database queries.
pub struct PgAccessRepo {
    pool: PgPool,
}

impl PgAccessRepo {
    /// Create a new PostgreSQL access repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AccessRepo for PgAccessRepo {
    type Err = anyhow::Error;

    async fn get_document_access(
        &self,
        document_id: &str,
        user_id: &str,
    ) -> Result<Option<AccessLevel>, Self::Err> {
        macro_db_client::share_permission::access_level::document::get_highest_access_level_for_document(
            &self.pool,
            document_id,
            user_id,
        )
        .await
    }

    async fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: &str,
    ) -> Result<Option<AccessLevel>, Self::Err> {
        macro_db_client::share_permission::access_level::chat::get_highest_access_level_for_chat(
            &self.pool,
            chat_id,
            user_id,
        )
        .await
    }

    async fn get_project_access(
        &self,
        project_id: &str,
        user_id: &str,
    ) -> Result<Option<AccessLevel>, Self::Err> {
        macro_db_client::share_permission::access_level::project::get_highest_access_level_for_project(
            &self.pool,
            project_id,
            user_id,
        )
        .await
    }

    async fn get_thread_access(
        &self,
        thread_id: &str,
        user_id: &str,
    ) -> Result<Option<AccessLevel>, Self::Err> {
        macro_db_client::share_permission::access_level::thread::get_highest_access_level_for_thread(
            &self.pool,
            thread_id,
            user_id,
        )
        .await
    }

    async fn get_macro_share_permission(
        &self,
        macro_id: &str,
    ) -> Result<SharePermissionInfo, Self::Err> {
        let permission =
            macro_db_client::share_permission::get::get_macro_share_permission(&self.pool, macro_id)
                .await?;

        // Convert from SharePermissionV2 to our domain type
        let channel_permissions = permission
            .channel_share_permissions
            .unwrap_or_default()
            .into_iter()
            .filter_map(|csp| {
                Uuid::from_str(&csp.channel_id).ok().map(|channel_id| {
                    ChannelPermission {
                        channel_id,
                        access_level: csp.access_level,
                    }
                })
            })
            .collect();

        Ok(SharePermissionInfo {
            owner_id: permission.owner,
            is_public: permission.is_public,
            public_access_level: permission.public_access_level,
            channel_permissions,
        })
    }
}
