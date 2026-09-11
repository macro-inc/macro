//! Reference sharing policy, independent of persistence and transport.

use super::{
    models::{ReferencedShareItem, ReferencedShareItemType},
    ports::ChannelReferenceSharePermissions,
};
use entity_access::domain::models::AccessLevel;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Facts and persistence required by reference sharing.
pub trait ReferenceShareRepository: Send + Sync + 'static {
    /// Resolve the sender's current access to the referenced entity.
    fn access(
        &self,
        actor: &MacroUserIdStr<'_>,
        item: &ReferencedShareItem,
    ) -> impl Future<Output = anyhow::Result<Option<AccessLevel>>> + Send;
    /// Persist a channel-scoped grant, idempotently.
    fn grant(
        &self,
        channel_id: Uuid,
        item: &ReferencedShareItem,
        level: AccessLevel,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Domain service for message-reference sharing.
#[derive(Clone)]
pub struct ReferenceShareService<R> {
    repo: R,
}

impl<R> ReferenceShareService<R> {
    /// Construct with the reference-sharing repository.
    pub fn from_repository(repo: R) -> Self {
        Self { repo }
    }
}

/// Agent control may only be shared by its owner; other references retain
/// the established view-sharing behavior. Mentioning never amplifies a viewer.
fn grant_level(
    item_type: ReferencedShareItemType,
    access: Option<AccessLevel>,
) -> Option<AccessLevel> {
    match (item_type, access) {
        (ReferencedShareItemType::AgentSession, Some(AccessLevel::Owner)) => {
            Some(AccessLevel::Edit)
        }
        (ReferencedShareItemType::AgentSession, _) | (_, None) => None,
        (_, Some(_)) => Some(AccessLevel::View),
    }
}

impl<R: ReferenceShareRepository> ChannelReferenceSharePermissions for ReferenceShareService<R> {
    type Err = anyhow::Error;

    async fn update_channel_share_permissions_for_referenced_items(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        items: Vec<ReferencedShareItem>,
    ) -> anyhow::Result<()> {
        for item in items {
            let access = self.repo.access(&actor, &item).await?;
            if let Some(level) = grant_level(item.entity_type(), access) {
                self.repo.grant(channel_id, &item, level).await?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
