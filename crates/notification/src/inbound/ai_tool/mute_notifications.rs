//! MuteNotifications tool: mute, snooze, or unmute notifications for one item.

use super::NotificationEntityType;
use crate::domain::item_preferences::{
    ItemNotificationPreferenceError, ItemNotificationPreferenceRepository,
    ItemNotificationPreferenceService,
};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use model_entity::EntityType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Service context for the user's per-item notification preferences.
pub struct ItemNotificationPreferenceToolContext<R> {
    /// The user's mute and snooze preferences.
    pub service: Arc<ItemNotificationPreferenceService<R>>,
}

impl<R> Clone for ItemNotificationPreferenceToolContext<R> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<R: ItemNotificationPreferenceRepository> ItemNotificationPreferenceToolContext<R> {
    /// Create a context over the user's preference repository.
    pub fn new(repository: R) -> Self {
        Self {
            service: Arc::new(ItemNotificationPreferenceService::new(repository)),
        }
    }
}

/// Create the item notification preference toolset.
pub fn item_notification_preference_toolset<R>()
-> AsyncToolCollection<ItemNotificationPreferenceToolContext<R>>
where
    R: ItemNotificationPreferenceRepository + 'static,
{
    AsyncToolCollection::new()
        .add_tool::<MuteNotifications, ItemNotificationPreferenceToolContext<R>>()
}

/// What to do with an item's notifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MuteAction {
    /// Stop notifications for the item until it is unmuted.
    Mute,
    /// Stop notifications for the item until `snoozeUntil`.
    Snooze,
    /// Resume notifications for the item.
    Unmute,
}

/// Mute, snooze, or unmute one item's notifications for the user.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "MuteNotifications",
    description = "Mute, snooze, or unmute notifications about one item for the user only, as Mute and Snooze in the app do. Muting never changes anyone else's notifications or the item itself. Use the entity type and id from ListNotifications or other tools."
)]
pub struct MuteNotifications {
    /// The item's type.
    #[schemars(description = "The item's entity type.")]
    pub entity_type: NotificationEntityType,
    /// The item's id.
    #[schemars(description = "The item's id.")]
    pub entity_id: String,
    /// What to do.
    #[schemars(
        description = "mute stops notifications until unmuted, snooze stops them until snoozeUntil, unmute resumes them."
    )]
    pub action: MuteAction,
    /// When a snooze ends.
    #[schemars(
        description = "When notifications resume, as an ISO 8601 timestamp in the future. Required for snooze; omit otherwise."
    )]
    #[serde(default)]
    pub snooze_until: Option<DateTime<Utc>>,
}

/// The item's notification state after the change.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MuteNotificationsResponse {
    /// The item's id.
    pub entity_id: String,
    /// What was done.
    pub action: MuteAction,
    /// When a snooze ends.
    pub snooze_until: Option<DateTime<Utc>>,
}

impl ToolAnnotated for MuteNotifications {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Mute notifications").with_idempotent();
}

fn invalid(description: &str) -> ToolCallError {
    ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::anyhow!("invalid MuteNotifications input: {description}"),
    }
}

#[async_trait]
impl<R> AsyncTool<ItemNotificationPreferenceToolContext<R>> for MuteNotifications
where
    R: ItemNotificationPreferenceRepository + 'static,
{
    type Output = MuteNotificationsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, action=?self.action), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ItemNotificationPreferenceToolContext<R>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let entity_id = self.entity_id.trim();
        if entity_id.is_empty() {
            return Err(invalid("entityId must not be empty"));
        }
        let entity = EntityType::from(self.entity_type).with_entity_str(entity_id);
        let user = request_context.user_id;
        let until = match (self.action, self.snooze_until) {
            (MuteAction::Snooze, None) => {
                return Err(invalid("snooze needs snoozeUntil"));
            }
            (MuteAction::Mute | MuteAction::Unmute, Some(_)) => {
                return Err(invalid("snoozeUntil only applies to snooze"));
            }
            (_, until) => until,
        };

        match self.action {
            MuteAction::Mute | MuteAction::Snooze => service_context
                .service
                .set(user, entity, until, Utc::now())
                .await
                .map_err(|error| match error {
                    ItemNotificationPreferenceError::InvalidDeadline => {
                        invalid("snoozeUntil must be in the future")
                    }
                    error @ ItemNotificationPreferenceError::Repository(_) => ToolCallError {
                        description: "failed to update notification preferences".to_string(),
                        internal_error: anyhow::anyhow!("{error}"),
                    },
                })?,
            MuteAction::Unmute => {
                service_context
                    .service
                    .remove(user, entity)
                    .await
                    .map_err(|error| ToolCallError {
                        description: "failed to update notification preferences".to_string(),
                        internal_error: anyhow::anyhow!("{error}"),
                    })?
            }
        }

        Ok(MuteNotificationsResponse {
            entity_id: entity_id.to_string(),
            action: self.action,
            snooze_until: until,
        })
    }
}
