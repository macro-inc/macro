//! Postgres-backed [`ChatRepo`] implementation.

mod queries;
#[cfg(test)]
mod test;

use crate::domain::models::{
    ChatErr, ChatResponse, CopyChatArgs, CreateChatArgs, PatchChatArgs, PatchChatMessageArgs,
    Result, WebCitation,
};
use crate::domain::ports::{ChatRepo, MessageRepo};
use agent::types::ChatMessageContent;
use attachment::FormattedParts;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::ChatMessageWithAttachments;
use model::chat::NewChatMessage;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts, TeamShareMaintenance,
};
use models_permissions::share_permission::{SharePermissionV2, TeamLinkShareDefault};
use rootcause::compat::boxed_error::IntoBoxedError;
use share_permission_db_utils::team_share::{self, TeamShareError};
use sqlx::PgPool;

fn team_share_error(error: rootcause::Report<TeamShareError>) -> ChatErr {
    match error.current_context() {
        TeamShareError::NotFound => ChatErr::NotFound,
        TeamShareError::ChangedFacts => ChatErr::Access(
            entity_access::domain::models::AccessError::UnauthorizedWithMessage(
                "chat ownership or team-share facts changed",
            ),
        ),
        TeamShareError::UntrackedGrant
        | TeamShareError::InvalidEntity
        | TeamShareError::InvalidAdoption => ChatErr::BadRequest(error.to_string()),
        TeamShareError::InvalidState | TeamShareError::Infrastructure => {
            ChatErr::Unknown(anyhow::Error::from_boxed(error.into_boxed_error()))
        }
    }
}

async fn synchronize_placement(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    chat_id: &str,
) -> Result<()> {
    let id = uuid::Uuid::parse_str(chat_id).map_err(|e| ChatErr::BadRequest(e.to_string()))?;
    entity_access_db_utils::project_inheritance::synchronize_entity(tx, &id, EntityType::Chat)
        .await
        .map_err(|e| ChatErr::Unknown(e.into()))
}

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

/// Postgres adapter for chat repository operations.
#[derive(Clone)]
pub struct PgChatRepo {
    pool: PgPool,
}

impl PgChatRepo {
    /// Create a new [`PgChatRepo`] with the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn begin_guarded(&self) -> Result<sqlx::Transaction<'_, sqlx::Postgres>> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;
        team_share::acquire_guard(&mut tx)
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(tx)
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

impl ChatRepo for PgChatRepo {
    #[tracing::instrument(err, skip(self, share_permission))]
    async fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
        share_permission: SharePermissionV2,
    ) -> Result<String> {
        let mut tx = self.begin_guarded().await?;

        let chat_id = queries::insert_chat::insert_chat(
            &mut tx,
            &user_id,
            &args.name,
            args.project_id.as_deref(),
        )
        .await
        .map_err(to_chat_err)?;

        queries::create_chat_permission::create_chat_permission(
            &mut tx,
            &chat_id,
            &share_permission,
        )
        .await
        .map_err(to_chat_err)?;

        queries::upsert_user_history::upsert_user_history(&mut tx, user_id.copied(), &chat_id)
            .await
            .map_err(to_chat_err)?;

        queries::upsert_item_last_accessed::upsert_item_last_accessed(&mut tx, &chat_id)
            .await
            .map_err(to_chat_err)?;

        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            &macro_uuid::string_to_uuid(&chat_id).unwrap(),
            entity_access_db_utils::EntityType::Chat,
            user_id.as_ref(),
            entity_access_db_utils::EntityAccessSourceType::User,
            entity_access_db_utils::AccessLevel::Owner,
        )
        .await
        .map_err(|e| ChatErr::Unknown(e.into()))?;

        synchronize_placement(&mut tx, &chat_id).await?;
        tx.commit().await.map_err(|e| {
            tracing::error!(error=?e, "create_chat transaction error");
            ChatErr::Unknown(e.into())
        })?;

        Ok(chat_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_default_link_share(
        &self,
        user_id: &str,
    ) -> Result<Option<TeamLinkShareDefault>> {
        share_permission_db_utils::get_team_default_link_share(&self.pool, user_id)
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_team_share_facts(&self, chat_id: &str) -> Result<TeamShareFacts> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;
        let facts = team_share::load_facts(&mut tx, &EntityType::Chat.with_entity_str(chat_id))
            .await
            .map_err(team_share_error)?;
        tx.commit().await.map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(facts)
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
        user_id: MacroUserIdStr<'static>,
        source_chat_id: &str,
        args: CopyChatArgs,
        share_permission: SharePermissionV2,
    ) -> Result<String> {
        let mut tx = self.begin_guarded().await?;

        let chat_id = queries::insert_chat::insert_chat(
            &mut tx,
            &user_id,
            &args.name,
            args.project_id.as_deref(),
        )
        .await
        .map_err(to_chat_err)?;

        queries::create_chat_permission::create_chat_permission(
            &mut tx,
            &chat_id,
            &share_permission,
        )
        .await
        .map_err(to_chat_err)?;

        queries::upsert_user_history::upsert_user_history(&mut tx, user_id.copied(), &chat_id)
            .await
            .map_err(to_chat_err)?;

        queries::upsert_item_last_accessed::upsert_item_last_accessed(&mut tx, &chat_id)
            .await
            .map_err(to_chat_err)?;

        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            &macro_uuid::string_to_uuid(&chat_id).unwrap(),
            entity_access_db_utils::EntityType::Chat,
            user_id.as_ref(),
            entity_access_db_utils::EntityAccessSourceType::User,
            entity_access_db_utils::AccessLevel::Owner,
        )
        .await
        .map_err(|e| ChatErr::Unknown(e.into()))?;

        queries::copy_messages::copy_messages(&mut tx, source_chat_id, &chat_id)
            .await
            .map_err(to_chat_err)?;

        synchronize_placement(&mut tx, &chat_id).await?;
        tx.commit().await.map_err(|e| {
            tracing::error!(error=?e, "copy_chat transaction error");
            ChatErr::Unknown(e.into())
        })?;

        Ok(chat_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete(
        &self,
        chat_id: &str,
        expected: TeamShareFacts,
        maintenance: Option<TeamShareMaintenance>,
    ) -> Result<()> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ChatErr::Unknown(e.into()))?;
        let facts = team_share::load_facts(&mut tx, &EntityType::Chat.with_entity_str(chat_id))
            .await
            .map_err(team_share_error)?;
        if facts != expected {
            return Err(team_share_error(rootcause::report!(
                TeamShareError::ChangedFacts
            )));
        }
        if let Some(maintenance) = maintenance {
            if !matches!(&maintenance, TeamShareMaintenance::Clear { expected } if *expected == facts)
            {
                return Err(team_share_error(rootcause::report!(
                    TeamShareError::ChangedFacts
                )));
            }
            team_share::maintain(&mut tx, &maintenance)
                .await
                .map_err(team_share_error)?;
        }
        queries::revert_delete_chat::revert_delete_chat(&mut tx, chat_id)
            .await
            .map_err(to_chat_err)?;
        synchronize_placement(&mut tx, chat_id).await?;
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
    async fn delete(&self, chat_id: &str) -> Result<()> {
        let mut tx = self.begin_guarded().await?;
        queries::soft_delete_chat::soft_delete_chat(&mut tx, chat_id)
            .await
            .map_err(to_chat_err)?;
        synchronize_placement(&mut tx, chat_id).await?;
        tx.commit().await.map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete(&self, chat_id: &str) -> Result<()> {
        let mut tx = self.begin_guarded().await?;
        queries::permanently_delete_chat::permanently_delete_chat(&mut tx, chat_id)
            .await
            .map_err(to_chat_err)?;
        tx.commit().await.map_err(|e| ChatErr::Unknown(e.into()))?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch(
        &self,
        expected_owner: MacroUserIdStr<'static>,
        chat_id: &str,
        args: PatchChatArgs,
        team_share: Option<AuthorizedTeamShareCommand>,
    ) -> Result<()> {
        let mut tx = self.begin_guarded().await?;
        let owner = sqlx::query_scalar!(
            r#"SELECT "userId" FROM "Chat" WHERE id = $1 FOR UPDATE"#,
            chat_id
        )
        .fetch_one(tx.as_mut())
        .await
        .map_err(|e| to_chat_err(e.into()))?;
        if owner != expected_owner.as_ref() {
            return Err(team_share_error(rootcause::report!(
                TeamShareError::ChangedFacts
            )));
        }
        let requested = args
            .share_permission
            .as_ref()
            .and_then(|p| p.team_share_access_level);
        match (&team_share, requested) {
            (Some(command), Some(level))
                if command.expected().entity == EntityType::Chat.with_entity_str(chat_id)
                    && command.expected().owner == expected_owner
                    && command.target().map(|grant| AccessLevel::from(grant.level)) == level =>
            {
                team_share::apply(&mut tx, command)
                    .await
                    .map_err(team_share_error)?;
            }
            (None, None) => {}
            _ => {
                return Err(ChatErr::BadRequest(
                    "team-share command does not match patch".into(),
                ));
            }
        }

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

        if args.project_id.is_some() {
            synchronize_placement(&mut tx, chat_id).await?;
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

impl MessageRepo for PgChatRepo {
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
