//! Session-authorized history with current access for CRM record content.
use super::error::AgentSessionError;
use activity::domain::ports::AgentActivityReads;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;
use uuid::Uuid;

/// Stable chronological resume position.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityCursor {
    /// Last stored event time.
    pub occurred_at: DateTime<Utc>,
    /// Tie-breaking activity identity.
    pub id: Uuid,
}

/// One page of the activity caused by this session.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityPage {
    /// Original activity rows, also retained in the affected entities' histories.
    pub activities: Vec<activity::ActivityWireRow>,
    /// Resume position, present when more raw rows remain.
    pub next_cursor: Option<AgentActivityCursor>,
}

/// Read using the session capability; CRM rows additionally require current record access.
pub async fn read<R: AgentActivityReads, A: entity_access::domain::ports::EntityAccessService>(
    repository: &R,
    permissions: &A,
    access: &EntityAccessReceipt<ViewAccessLevel>,
    correlation_id: Option<Uuid>,
    cursor: Option<AgentActivityCursor>,
    limit: NonZeroU32,
) -> Result<AgentActivityPage, AgentSessionError> {
    let session_id = Uuid::parse_str(&access.entity().entity_id)
        .map_err(|error| AgentSessionError::Unknown(error.into()))?;
    let page = repository
        .agent_activity(
            session_id,
            correlation_id,
            cursor.map(|c| (c.occurred_at, c.id)),
            limit,
        )
        .await
        .map_err(|error| AgentSessionError::Unknown(error.into()))?;
    let keys: Vec<_> = page
        .records
        .iter()
        .filter(|record| is_crm(record.entity_type))
        .map(|record| (record.entity_type, record.entity_id.clone()))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let visible = if let Some(viewer) = access.acting_user_id() {
        Some(
            permissions
                .visible_crm_entities(viewer, &keys)
                .await
                .map_err(|error| AgentSessionError::Unknown(error.into()))?,
        )
    } else {
        None
    };
    let mut checked = std::collections::HashMap::new();
    let mut activities = Vec::new();
    for record in page.records {
        let key = (record.entity_type, record.entity_id.clone());
        let allowed = if !is_crm(record.entity_type) {
            true
        } else if let Some(visible) = &visible {
            visible.contains(&key)
        } else if let Some(allowed) = checked.get(&key) {
            *allowed
        } else {
            let allowed =
                crm_record_visible(permissions, access, record.entity_type, &record.entity_id)
                    .await?;
            checked.insert(key, allowed);
            allowed
        };
        if allowed {
            activities.push(activity::ActivityWireRow::from(record));
        }
    }
    Ok(AgentActivityPage {
        activities,
        next_cursor: page
            .next
            .map(|(occurred_at, id)| AgentActivityCursor { occurred_at, id }),
    })
}

fn is_crm(kind: activity::EntityType) -> bool {
    matches!(
        kind,
        activity::EntityType::CrmCompany
            | activity::EntityType::CrmContact
            | activity::EntityType::CrmPipeline
    )
}

async fn crm_record_visible<A: entity_access::domain::ports::EntityAccessService>(
    permissions: &A,
    receipt: &EntityAccessReceipt<ViewAccessLevel>,
    kind: activity::EntityType,
    id: &str,
) -> Result<bool, AgentSessionError> {
    use entity_access::domain::models::{
        AccessError, BotAccessScope, BotReceiptScope, EntityAccessAuth, EntityType,
    };
    if !matches!(
        kind,
        EntityType::CrmCompany | EntityType::CrmContact | EntityType::CrmPipeline
    ) {
        return Ok(true);
    }
    let result = if let Some(viewer) = receipt.acting_user_id() {
        permissions
            .generate_entity_access_receipt::<ViewAccessLevel>(viewer, None, id, kind)
            .await
    } else {
        match receipt.auth() {
            EntityAccessAuth::Internal => return Ok(true),
            EntityAccessAuth::Bot(bot) => match bot.scope() {
                BotReceiptScope::Team { team_id } => {
                    permissions
                        .generate_bot_entity_access_receipt::<ViewAccessLevel>(
                            bot.bot_id(),
                            BotAccessScope::Team { team_id: *team_id },
                            id,
                            kind,
                        )
                        .await
                }
                _ => return Ok(false),
            },
            _ => return Ok(false),
        }
    };
    match result {
        Ok(_) => Ok(true),
        Err(
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_)
            | AccessError::BadRequest(_),
        ) => Ok(false),
        Err(error) => Err(AgentSessionError::Unknown(error.into())),
    }
}
