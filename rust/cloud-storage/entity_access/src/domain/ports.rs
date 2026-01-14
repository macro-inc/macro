use crate::domain::models::{AccessError, AccessLevel, EntityType, SharePermissionInfo};
use std::future::Future;
use uuid::Uuid;

#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait AccessRepo: Send + Sync + 'static {
    type Err: Into<anyhow::Error> + Send + Sync + 'static;

    fn get_document_access(
        &self,
        document_id: &str,
        user_id: &str,
    ) -> impl Future<Output = Result<Option<AccessLevel>, Self::Err>> + Send;

    fn get_chat_access(
        &self,
        chat_id: &str,
        user_id: &str,
    ) -> impl Future<Output = Result<Option<AccessLevel>, Self::Err>> + Send;

    fn get_project_access(
        &self,
        project_id: &str,
        user_id: &str,
    ) -> impl Future<Output = Result<Option<AccessLevel>, Self::Err>> + Send;

    fn get_thread_access(
        &self,
        thread_id: &str,
        user_id: &str,
    ) -> impl Future<Output = Result<Option<AccessLevel>, Self::Err>> + Send;

    fn get_macro_share_permission(
        &self,
        macro_id: &str,
    ) -> impl Future<Output = Result<SharePermissionInfo, Self::Err>> + Send;

    fn check_channel_users(
        &self,
        user_id: &str,
        channel_ids: &[Uuid]
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>>> + Send;
}

pub trait EntityAccessService: Send + Sync + 'static {
    fn get_access_level(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Option<AccessLevel>, AccessError>> + Send;
}
