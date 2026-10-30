//! Postgres-backed [`ChatRepo`] implementation.

mod queries;
mod team_share;
#[cfg(test)]
mod test;

use crate::domain::models::{
    ChatErr, ChatResponse, CopyChatArgs, CreateChatArgs, PatchChatMessageArgs, PatchChatRepoArgs,
    Result, WebCitation,
};
use crate::domain::ports::{ChatRepo, MessageRepo};
use agent::types::ChatMessageContent;
use attachment::FormattedParts;
use entity_registry::BotFacts;
use entity_registry_db_utils::{NewEntityRecord, OwnedEntityRegistrar, RegisteredEntityType};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::ChatMessageWithAttachments;
use model::chat::NewChatMessage;
use model_owner::Owner;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::TeamShareFacts;
use models_permissions::share_permission::{SharePermissionV2, TeamLinkShareDefault};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

/// Convert an [`anyhow::Error`] to a [`ChatErr`], detecting `sqlx::RowNotFound`.
fn to_chat_err(e: anyhow::Error) -> ChatErr {
    if e.downcast_ref::<sqlx::Error>()
        .is_some_and(|e| matches!(e, sqlx::Error::RowNotFound))
    {
        ChatErr::NotFound
    } else {
        ChatErr::Unknown(e)
    }
}

/// Insert a chat row for `owner` with its share permission and recency rows,
/// returning the chat id and its registry uuid.
async fn insert_owned_chat(
    tx: &mut Transaction<'_, Postgres>,
    owner: &Owner,
    name: &str,
    project_id: Option<&str>,
    share_permission: &SharePermissionV2,
) -> Result<(String, Uuid)> {
    let chat_id = queries::insert_chat::insert_chat(tx, owner, name, project_id)
        .await
        .map_err(to_chat_err)?;

    queries::create_chat_permission::create_chat_permission(tx, &chat_id, share_permission)
        .await
        .map_err(to_chat_err)?;

    // `UserHistory."userId"` still references `"User"`, so only a user owner has history.
    if let Some(user_id) = owner.as_user() {
        queries::upsert_user_history::upsert_user_history(tx, user_id.copied(), &chat_id)
            .await
            .map_err(to_chat_err)?;
    }

    queries::upsert_item_last_accessed::upsert_item_last_accessed(tx, &chat_id)
        .await
        .map_err(to_chat_err)?;

    let chat_uuid = macro_uuid::string_to_uuid(&chat_id).map_err(to_chat_err)?;
    Ok((chat_id, chat_uuid))
}

/// Postgres adapter for chat repository operations.
#[derive(Clone)]
pub struct PgChatRepo<B> {
    pool: PgPool,
    registrar: OwnedEntityRegistrar<B>,
}

impl<B: BotFacts + 'static> PgChatRepo<B> {
    /// Create a new [`PgChatRepo`] with the given connection pool. Created and
    /// copied chats register their owner grants through `registrar`.
    pub fn new(pool: PgPool, registrar: OwnedEntityRegistrar<B>) -> Self {
        Self { pool, registrar }
    }

    async fn get_messages(&self, chat_id: &str) -> anyhow::Result<Vec<ChatMessageWithAttachments>> {
        queries::get_messages::get_messages(&self.pool, chat_id).await
    }

    async fn persist_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &ChatMessageContent,
        bump_chat_recency: bool,
    ) -> Result<()> {
        queries::update_message_content::update_message_content(
            &self.pool,
            chat_id,
            message_id,
            content,
            bump_chat_recency,
        )
        .await
        .map_err(to_chat_err)
    }

    /// Store a resolved message without going through the trait.
    pub async fn store_resolved_message_static(
        &self,
        message_id: &str,
        parts: FormattedParts,
    ) -> anyhow::Result<()> {
        queries::store_resolved_message::store_resolved_message(&self.pool, message_id, parts).await
    }
}

impl<B: BotFacts + 'static> ChatRepo for PgChatRepo<B> {
    #[tracing::instrument(err, skip(self, share_permission))]
    async fn create(
        &self,
        owner: Owner,
        args: CreateChatArgs,
        share_permission: SharePermissionV2,
    ) -> Result<String> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;

        let (chat_id, chat_uuid) = insert_owned_chat(
            &mut tx,
            &owner,
            &args.name,
            args.project_id.as_deref(),
            &share_permission,
        )
        .await?;

        self.registrar
            .register_owned_entity(
                &mut tx,
                NewEntityRecord::new(chat_uuid, RegisteredEntityType::Chat, owner),
            )
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;

        tx.commit().await.map_err(|e| {
            tracing::error!(error=?e, "create_chat transaction error");
            ChatErr::Unknown(e.into())
        })?;

        Ok(chat_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_default_link_share(
        &self,
        owner: &Owner,
    ) -> Result<Option<TeamLinkShareDefault>> {
        queries::owner_team_link_share::owner_team_link_share(&self.pool, owner)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self))]
    #[allow(deprecated)]
    async fn get_chat(&self, chat_id: &str) -> Result<ChatResponse> {
        let chat = self.get_metadata(chat_id).await?;
        let mut messages = self.get_messages(chat_id).await.map_err(to_chat_err)?;
        messages.retain(|m| m.role != agent::types::Role::System);
        Ok(ChatResponse {
            id: chat.id,
            user_id: chat.user_id,
            name: chat.name,
            model: chat.model,
            messages,
            project_id: chat.project_id,
            created_at: chat.created_at,
            updated_at: chat.updated_at,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_metadata(&self, chat_id: &str) -> Result<model::chat::Chat> {
        queries::get_chat::get_chat(&self.pool, chat_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_access_level(
        &self,
        user_id: MacroUserIdStr<'_>,
        chat_id: &str,
    ) -> Result<AccessLevel> {
        queries::get_access_level::get_access_level(&self.pool, user_id.as_ref(), chat_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self, share_permission))]
    async fn copy_chat(
        &self,
        owner: Owner,
        source_chat_id: &str,
        args: CopyChatArgs,
        share_permission: SharePermissionV2,
    ) -> Result<String> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;

        let (chat_id, chat_uuid) = insert_owned_chat(
            &mut tx,
            &owner,
            &args.name,
            args.project_id.as_deref(),
            &share_permission,
        )
        .await?;

        queries::copy_messages::copy_messages(&mut tx, source_chat_id, &chat_id)
            .await
            .map_err(to_chat_err)?;

        self.registrar
            .register_owned_entity(
                &mut tx,
                NewEntityRecord::new(chat_uuid, RegisteredEntityType::Chat, owner),
            )
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;

        tx.commit().await.map_err(|e| {
            tracing::error!(error=?e, "copy_chat transaction error");
            ChatErr::Unknown(e.into())
        })?;

        Ok(chat_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete(&self, chat_id: &str, project_id: Option<&str>) -> Result<()> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;
        queries::revert_delete_chat::revert_delete_chat(&mut tx, chat_id, project_id)
            .await
            .map_err(to_chat_err)?;
        tx.commit().await.map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_permissions(&self, chat_id: &str) -> Result<SharePermissionV2> {
        queries::get_permissions::get_chat_share_permission(&self.pool, chat_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_share_facts(&self, chat_id: &str) -> Result<TeamShareFacts> {
        team_share::get_team_share_facts(&self.pool, chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete(&self, chat_id: &str) -> Result<()> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;
        queries::soft_delete_chat::soft_delete_chat(&mut tx, chat_id)
            .await
            .map_err(to_chat_err)?;
        tx.commit().await.map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete(&self, chat_id: &str) -> Result<()> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;
        queries::permanently_delete_chat::permanently_delete_chat(&mut tx, chat_id)
            .await
            .map_err(to_chat_err)?;
        tx.commit().await.map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn patch(
        &self,
        user_id: MacroUserIdStr<'static>,
        chat_id: &str,
        args: PatchChatRepoArgs,
    ) -> Result<()> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;

        // Canonical team sharing first: it takes the shared guard before any
        // `SharePermission` row lock and refuses an unauthorized team level.
        team_share::apply_team_share(
            &mut tx,
            chat_id,
            args.share_permission.as_ref(),
            args.team_share.as_ref(),
        )
        .await?;

        queries::patch_chat::patch_chat(
            &mut tx,
            chat_id,
            args.name.as_deref(),
            args.project_id.as_deref(),
        )
        .await
        .map_err(to_chat_err)?;

        if let Some(ref share_permission) = args.share_permission {
            queries::edit_share_permission::edit_chat_permission(
                &mut tx,
                chat_id,
                share_permission,
            )
            .await
            .map_err(to_chat_err)?;
        }

        tx.commit().await.map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn update_project_modified(&self, project_id: &str) -> Result<()> {
        queries::update_project_modified::update_project_modified(&self.pool, project_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch_message(&self, chat_id: &str, args: PatchChatMessageArgs) -> Result<()> {
        self.persist_message_content(chat_id, &args.message_id, &args.content, true)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> Result<ChatMessageContent> {
        queries::get_message_content::get_message_content(&self.pool, chat_id, message_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self, content))]
    async fn update_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &ChatMessageContent,
    ) -> Result<()> {
        self.persist_message_content(chat_id, message_id, content, true)
            .await
    }

    #[tracing::instrument(err, skip(self, content))]
    async fn update_interim_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &ChatMessageContent,
    ) -> Result<()> {
        self.persist_message_content(chat_id, message_id, content, false)
            .await
    }

    #[tracing::instrument(err, skip(self, parts))]
    async fn store_resolved_message(&self, message_id: &str, parts: FormattedParts) -> Result<()> {
        queries::store_resolved_message::store_resolved_message(&self.pool, message_id, parts)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(skip(self))]
    async fn get_resolved_message(&self, message_id: &str) -> Result<FormattedParts> {
        queries::get_resolved_message::get_resolved_message(&self.pool, message_id)
            .await
            .map_err(to_chat_err)
    }
}

impl<B: BotFacts + 'static> MessageRepo for PgChatRepo<B> {
    #[tracing::instrument(err, skip(self, message))]
    async fn create(&self, chat_id: &str, message: NewChatMessage) -> Result<String> {
        queries::create_message::create_message(&self.pool, chat_id, message)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete(&self, message_id: &str) -> Result<String> {
        queries::delete_message::delete_message(&self.pool, message_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_messages(&self, chat_id: &str) -> Result<Vec<ChatMessageWithAttachments>> {
        queries::get_messages::get_messages(&self.pool, chat_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> Result<ChatMessageContent> {
        queries::get_message_content::get_message_content(&self.pool, chat_id, message_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self, content))]
    async fn update_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &ChatMessageContent,
    ) -> Result<()> {
        self.persist_message_content(chat_id, message_id, content, true)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch_message(&self, chat_id: &str, args: PatchChatMessageArgs) -> Result<()> {
        self.persist_message_content(chat_id, &args.message_id, &args.content, true)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn copy_messages(&self, source_chat_id: &str, dest_chat_id: &str) -> Result<()> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;
        queries::copy_messages::copy_messages(&mut tx, source_chat_id, dest_chat_id)
            .await
            .map_err(to_chat_err)?;
        tx.commit().await.map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_web_citations(&self, chat_id: &str) -> Result<Vec<(String, Vec<WebCitation>)>> {
        queries::get_web_citations::get_web_citations(&self.pool, chat_id)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(err, skip(self, parts))]
    async fn store_resolved_message(&self, message_id: &str, parts: FormattedParts) -> Result<()> {
        queries::store_resolved_message::store_resolved_message(&self.pool, message_id, parts)
            .await
            .map_err(to_chat_err)
    }

    #[tracing::instrument(skip(self))]
    async fn get_resolved_message(&self, message_id: &str) -> Result<FormattedParts> {
        queries::get_resolved_message::get_resolved_message(&self.pool, message_id)
            .await
            .map_err(to_chat_err)
    }
}
