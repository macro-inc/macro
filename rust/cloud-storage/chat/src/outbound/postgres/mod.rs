//! Postgres-backed [`ChatRepo`] implementation.

mod queries;
#[cfg(test)]
mod test;

use crate::domain::ports::ChatRepo;
use crate::models::{ChatResponse, CopyChatArgs, CreateChatArgs, PatchChatArgs, WebCitation};
use ai::types::Model;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::ChatMessageWithAttachments;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::PgPool;

/// The default model used when no model is set on a chat.
const FALLBACK_MODEL: Model = Model::Claude45Haiku;

/// Postgres adapter for chat repository operations.
pub struct PgChatRepo {
    pool: PgPool,
}

impl PgChatRepo {
    /// Create a new [`PgChatRepo`] with the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn get_messages(&self, chat_id: &str) -> anyhow::Result<Vec<ChatMessageWithAttachments>> {
        queries::get_messages::get_messages(&self.pool, chat_id).await
    }

    async fn get_web_citations(
        &self,
        chat_id: &str,
    ) -> anyhow::Result<Vec<(String, Vec<WebCitation>)>> {
        queries::get_web_citations::get_web_citations(&self.pool, chat_id).await
    }
}

impl ChatRepo for PgChatRepo {
    #[tracing::instrument(err, skip(self))]
    async fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
    ) -> anyhow::Result<String> {
        let mut tx = self.pool.begin().await?;

        let chat_id = queries::insert_chat::insert_chat(
            &mut tx,
            &user_id,
            &args.name,
            args.project_id.as_deref(),
        )
        .await?;

        let share_permission = SharePermissionV2::new_chat_share_permission();
        queries::create_chat_permission::create_chat_permission(
            &mut tx,
            &chat_id,
            &share_permission,
        )
        .await?;

        queries::upsert_user_history::upsert_user_history(&mut tx, user_id.copied(), &chat_id)
            .await?;

        queries::upsert_item_last_accessed::upsert_item_last_accessed(&mut tx, &chat_id).await?;

        queries::insert_user_item_access::insert_user_item_access(
            &mut tx,
            user_id.copied(),
            &chat_id,
            AccessLevel::Owner,
        )
        .await?;

        tx.commit().await.map_err(|e| {
            tracing::error!(error=?e, "create_chat transaction error");
            anyhow::Error::from(e)
        })?;

        Ok(chat_id)
    }

    #[tracing::instrument(err, skip(self))]
    #[allow(deprecated)]
    async fn get_chat(&self, chat_id: &str) -> anyhow::Result<ChatResponse> {
        let chat = self.get_metadata(chat_id).await?;
        let mut messages = self.get_messages(chat_id).await?;
        messages.retain(|m| m.role != ai::types::Role::System);
        let web_citations = self.get_web_citations(chat_id).await.unwrap_or_default();

        Ok(ChatResponse {
            id: chat.id,
            user_id: chat.user_id,
            name: chat.name,
            model: Some(FALLBACK_MODEL),
            messages,
            project_id: chat.project_id,
            created_at: chat.created_at,
            updated_at: chat.updated_at,
            attachments: Vec::new(),
            token_count: chat.token_count,
            available_models: vec![FALLBACK_MODEL],
            web_citations,
            is_persistent: chat.is_persistent,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_metadata(&self, chat_id: &str) -> anyhow::Result<model::chat::Chat> {
        queries::get_chat::get_chat(&self.pool, chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_access_level(
        &self,
        user_id: MacroUserIdStr<'_>,
        chat_id: &str,
    ) -> anyhow::Result<AccessLevel> {
        queries::get_access_level::get_access_level(&self.pool, user_id.as_ref(), chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn copy_chat(
        &self,
        user_id: MacroUserIdStr<'static>,
        source_chat_id: &str,
        args: CopyChatArgs,
    ) -> anyhow::Result<String> {
        let mut tx = self.pool.begin().await?;

        let chat_id = queries::insert_chat::insert_chat(
            &mut tx,
            &user_id,
            &args.name,
            args.project_id.as_deref(),
        )
        .await?;

        let share_permission = SharePermissionV2::new_chat_share_permission();
        queries::create_chat_permission::create_chat_permission(
            &mut tx,
            &chat_id,
            &share_permission,
        )
        .await?;

        queries::upsert_user_history::upsert_user_history(&mut tx, user_id.copied(), &chat_id)
            .await?;

        queries::upsert_item_last_accessed::upsert_item_last_accessed(&mut tx, &chat_id).await?;

        queries::insert_user_item_access::insert_user_item_access(
            &mut tx,
            user_id.copied(),
            &chat_id,
            AccessLevel::Owner,
        )
        .await?;

        queries::copy_messages::copy_messages(&mut tx, source_chat_id, &chat_id).await?;

        tx.commit().await.map_err(|e| {
            tracing::error!(error=?e, "copy_chat transaction error");
            anyhow::Error::from(e)
        })?;

        Ok(chat_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete(&self, chat_id: &str, project_id: Option<&str>) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        queries::revert_delete_chat::revert_delete_chat(&mut tx, chat_id, project_id).await?;
        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_permissions(&self, chat_id: &str) -> anyhow::Result<SharePermissionV2> {
        queries::get_permissions::get_chat_share_permission(&self.pool, chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete(&self, chat_id: &str) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        queries::soft_delete_chat::soft_delete_chat(&mut tx, chat_id).await?;
        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete(&self, chat_id: &str) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        queries::permanently_delete_chat::permanently_delete_chat(&mut tx, chat_id).await?;
        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch(
        &self,
        user_id: MacroUserIdStr<'static>,
        chat_id: &str,
        args: PatchChatArgs,
    ) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;

        queries::patch_chat::patch_chat(
            &mut tx,
            chat_id,
            args.name.as_deref(),
            args.project_id.as_deref(),
        )
        .await?;

        if let Some(ref share_permission) = args.share_permission {
            queries::edit_share_permission::edit_chat_permission(
                &mut tx,
                chat_id,
                share_permission,
            )
            .await?;

            macro_share_permissions::user_item_access::update_user_item_access(
                &mut tx,
                user_id.as_ref(),
                chat_id,
                "chat",
                share_permission,
            )
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }
}
