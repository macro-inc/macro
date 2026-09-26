//! Authorized, paginated project history with task references checked at read time.

use activity::domain::ports::EntityActivityReads;
use activity::{Action, ActivityRecord, RecordedAction};
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotReceiptScope, EntityAccessAuth,
        EntityAccessReceipt, EntityType, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, num::NonZeroU32, sync::Arc};
use uuid::Uuid;

use super::models::InitiativeError;

/// Stable cursor for project history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "toolset", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeActivityCursor {
    /// Time of the last scanned activity.
    pub occurred_at: DateTime<Utc>,
    /// Tie-breaker within the same timestamp.
    pub id: Uuid,
}

/// One authorized activity row; task names are hydrated through existing authorized task reads.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "toolset", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeActivityRecord {
    /// Stable record identifier, also used for realtime deduplication.
    pub id: Uuid,
    /// Principal who acted.
    pub actor_id: String,
    /// Acting user's feed identity when a bot acted on their behalf.
    pub subject_id: String,
    /// Durable activity action tag.
    pub action: String,
    /// Typed payload for known actions. Absent for unknown actions.
    pub action_payload: Option<Value>,
    /// Time of the change.
    pub occurred_at: DateTime<Utc>,
}

impl From<ActivityRecord> for InitiativeActivityRecord {
    fn from(record: ActivityRecord) -> Self {
        let (action, action_payload) = match record.action {
            RecordedAction::Known(action) => {
                let (tag, payload) = action.to_columns();
                (tag.to_string(), payload)
            }
            // A newer payload may contain references this reader cannot authorize.
            RecordedAction::Unknown { tag, .. } => (tag, None),
        };
        Self {
            id: record.id,
            actor_id: record.actor.as_ref().to_string(),
            subject_id: record.subject_id,
            action,
            action_payload,
            occurred_at: record.occurred_at,
        }
    }
}

/// History page. Access filtering can shorten records; follow nextCursor until exhausted.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeActivityPage {
    /// Visible changes in newest-first order.
    pub records: Vec<InitiativeActivityRecord>,
    /// The next raw-row boundary, including when this page had no visible task events.
    pub next_cursor: Option<InitiativeActivityCursor>,
}

/// Read service assembled with the owning activity and entity-access services.
pub struct InitiativeHistory<R, A> {
    reads: R,
    access: Arc<A>,
}

impl<R: EntityActivityReads, A: EntityAccessService> InitiativeHistory<R, A> {
    /// Compose the history reader without introducing a Soup dependency.
    pub fn new(reads: R, access: Arc<A>) -> Self {
        Self { reads, access }
    }

    /// Read project history after verifying project view access at the boundary.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        cursor: Option<InitiativeActivityCursor>,
        limit: u32,
    ) -> Result<InitiativeActivityPage, InitiativeError> {
        if receipt.entity().entity_type != EntityType::Initiative {
            return Err(InitiativeError::BadRequest(
                "requires an initiative receipt".into(),
            ));
        }
        if !(1..=100).contains(&limit) {
            return Err(InitiativeError::BadRequest(
                "activity limit must be between 1 and 100".into(),
            ));
        }
        let page = self
            .reads
            .entity_feed(
                EntityType::Initiative,
                &receipt.entity().entity_id,
                cursor.map(|cursor| (cursor.occurred_at, cursor.id)),
                NonZeroU32::new(limit).expect("validated limit"),
            )
            .await
            .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))?;
        let mut visibility = HashMap::new();
        let mut records = Vec::new();
        for record in page.records {
            if let RecordedAction::Known(Action::TaskAdded(change) | Action::TaskRemoved(change)) =
                &record.action
            {
                let allowed = if let Some(allowed) = visibility.get(&change.task_id) {
                    *allowed
                } else {
                    let allowed = self.task_visible(&receipt, &change.task_id).await?;
                    visibility.insert(change.task_id.clone(), allowed);
                    allowed
                };
                if !allowed {
                    continue;
                }
            }
            records.push(record.into());
        }
        Ok(InitiativeActivityPage {
            records,
            next_cursor: page
                .next
                .map(|(occurred_at, id)| InitiativeActivityCursor { occurred_at, id }),
        })
    }

    async fn task_visible(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
        task_id: &str,
    ) -> Result<bool, InitiativeError> {
        let result = match receipt.auth() {
            EntityAccessAuth::Authenticated(user) => self
                .access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    user,
                    None,
                    task_id,
                    EntityType::Document,
                )
                .await
                .map(|_| ()),
            EntityAccessAuth::Bot(bot) => {
                let scope = match bot.scope() {
                    BotReceiptScope::User { acting_user } => {
                        BotAccessScope::user(acting_user.clone())
                    }
                    BotReceiptScope::Team { team_id } => BotAccessScope::Team { team_id: *team_id },
                    BotReceiptScope::Channel { .. } => return Ok(false),
                };
                self.access
                    .generate_bot_entity_access_receipt::<ViewAccessLevel>(
                        bot.bot_id(),
                        scope,
                        task_id,
                        EntityType::Document,
                    )
                    .await
                    .map(|_| ())
            }
            EntityAccessAuth::Unauthenticated => self
                .access
                .check_public_access(task_id, EntityType::Document, AccessLevel::View)
                .await
                .map(|_| ()),
            EntityAccessAuth::Internal => return Ok(true),
        };
        match result {
            Ok(()) => Ok(true),
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::NotFound(_)
                | AccessError::BadRequest(_),
            ) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }
}
