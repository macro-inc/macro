//! Default [`ChatService`] implementation backed by a [`ChatRepo`].

use crate::domain::{
    models::{ChatErr, CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs},
    ports::{ChatRepo, ChatService},
};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::SharePermissionV2;

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

impl<R: ChatRepo> ChatService for ChatServiceImpl<R> {
    #[tracing::instrument(err, skip(self))]
    async fn create(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateChatArgs,
    ) -> Result<String, ChatErr> {
        self.repo.create(user_id, args).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_chat(
        &self,
        user_id: MacroUserIdStr<'_>,
        chat_id: &str,
    ) -> Result<GetChatResponse, ChatErr> {
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
        user_id: MacroUserIdStr<'static>,
        chat_id: &str,
    ) -> Result<String, ChatErr> {
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
    async fn delete(&self, chat_id: &str) -> Result<(), ChatErr> {
        self.repo.delete(chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete(&self, chat_id: &str) -> Result<(), ChatErr> {
        self.repo.permanently_delete(chat_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn patch(
        &self,
        user_id: MacroUserIdStr<'static>,
        chat_id: &str,
        args: PatchChatArgs,
    ) -> Result<(), ChatErr> {
        self.repo.patch(user_id, chat_id, args).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn revert_delete(&self, chat_id: &str) -> Result<(), ChatErr> {
        let chat = self.repo.get_metadata(chat_id).await?;
        self.repo
            .revert_delete(chat_id, chat.project_id.as_deref())
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_permissions(&self, chat_id: &str) -> Result<SharePermissionV2, ChatErr> {
        self.repo.get_permissions(chat_id).await
    }
}
