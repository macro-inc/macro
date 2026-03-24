//! Default [`ChatService`] implementation backed by a [`ChatRepo`].

use crate::domain::{
    models::{ChatErr, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs},
    ports::{ChatRepo, ChatService},
};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::SharePermissionV2;
use unicode_segmentation::UnicodeSegmentation;

/// Concrete service implementation that delegates to a [`ChatRepo`].
pub struct ChatServiceImpl<R> {
    repo: R,
}

impl<R: ChatRepo> ChatServiceImpl<R> {
    /// Create a new [`ChatServiceImpl`] wrapping the given repo.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

/// Extract an authenticated user ID from an [`EntityAccessReceipt`], or return an error.
fn extract_user_id<T: entity_access::domain::models::RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<MacroUserIdStr<'static>, ChatErr> {
    match receipt.auth() {
        EntityAccessAuth::Authenticated(id) => Ok(id.clone()),
        _ => Err(ChatErr::Unknown(anyhow::anyhow!("unauthenticated"))),
    }
}

impl<R: ChatRepo> ChatService for ChatServiceImpl<R> {
    #[tracing::instrument(err, skip(self))]
    async fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
    ) -> Result<String, ChatErr> {
        if args.name.graphemes(true).count() > 100 {
            return Err(ChatErr::BadRequest("name too long".to_string()));
        }

        self.repo.create(user_id, args).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetChatResponse, ChatErr> {
        let user_id = extract_user_id(&entity_access_receipt)?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        let (chat, access_level) = tokio::join!(
            self.repo.get_chat(chat_id),
            self.repo.get_access_level(user_id, chat_id),
        );

        Ok(GetChatResponse {
            chat: chat?,
            user_access_level: access_level?,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn copy_chat(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, ChatErr> {
        let user_id = extract_user_id(&entity_access_receipt)?;
        let chat_id = &entity_access_receipt.entity().entity_id;

        let chat = self.repo.get_metadata(chat_id).await?;
        self.repo
            .copy_chat(
                user_id,
                chat_id,
                CopyChatArgs {
                    name: format!("{} Copy", chat.name),
                    project_id: None,
                },
            )
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.delete(chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.permanently_delete(chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        args: PatchChatArgs,
    ) -> Result<(), ChatErr> {
        if let Some(name) = args.name.as_ref()
            && name.graphemes(true).count() > 100
        {
            return Err(ChatErr::BadRequest("name too long".to_string()));
        }

        let user_id = extract_user_id(&entity_access_receipt)?;
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.patch(user_id, chat_id, args).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        let chat = self.repo.get_metadata(chat_id).await?;
        self.repo
            .revert_delete(chat_id, chat.project_id.as_deref())
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_permissions(
        &self,
        entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<SharePermissionV2, ChatErr> {
        let chat_id = &entity_access_receipt.entity().entity_id;
        self.repo.get_permissions(chat_id).await
    }
}
