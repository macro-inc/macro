//! Sharing a routine as a template that other people activate as their own
//! routine. A routine runs as its owner, so it is never shared itself: its
//! owner publishes a snapshot whose references are marked as variables, and
//! each person who activates it gets an ordinary routine of their own that
//! points back at the template.

use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, OwnerAccessLevel};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::{CreationPrincipal, Owner};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use super::event_trigger::ActionTrigger;
use super::models::{ActionPolicyError, CreateScheduledAction, ScheduledAction};
use super::ports::{RoutineTemplateRepo, RoutineTemplateService, ScheduledActionService};

#[cfg(test)]
mod test;

/// Longest description a template can carry.
pub const MAX_DESCRIPTION_CHARS: usize = 1_000;
/// Most variables a template can mark.
pub const MAX_VARIABLES: usize = 100;
/// PostHog rollout shared with the web app; missing or failed evaluations stay off.
pub const ROUTINE_SHARING_FLAG: &str = "enable-routine-sharing";

/// How a variable is filled when someone activates the template.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum VariableFill {
    /// Replaced by the person activating it, such as the author's own
    /// mention or the schedule's time zone.
    Activator,
    /// The same item for everyone. Kept when the activator can open it.
    Shared,
    /// Each person chooses their own. Left out unless they replace it.
    Choice,
}

/// A user-specific part of a shared routine.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TemplateVariable {
    /// A person mentioned in the instructions, by their user ID.
    User {
        id: String,
        label: String,
        fill: VariableFill,
    },
    /// A document, channel or other item mentioned in the instructions.
    Item {
        id: String,
        /// The mention's block name, such as `channel` or `md`.
        block_name: String,
        label: String,
        fill: VariableFill,
    },
    /// The time zone of the routine's schedules.
    TimeZone {
        #[schema(value_type = String)]
        timezone: Tz,
        fill: VariableFill,
    },
}

/// What the owner supplies when sharing; the rest is snapshotted from the routine.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ShareRoutineTemplate {
    pub description: String,
    pub variables: Vec<TemplateVariable>,
}

/// A shared routine's snapshot, readable by signed-in users with sharing enabled.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct RoutineTemplate {
    /// The routine it was shared from.
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    /// Who shared it: the source routine's owner.
    #[schema(value_type = String)]
    pub author: Owner,
    pub name: String,
    pub description: String,
    pub trigger: ActionTrigger,
    #[schema(value_type = Object)]
    pub task: Value,
    pub variables: Vec<TemplateVariable>,
    /// Routines activated from this template, including stopped ones.
    pub active_count: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// The snapshot written when an owner shares or re-shares a routine.
#[derive(Debug, Clone)]
pub struct TemplateSnapshot {
    pub action_id: Uuid,
    pub name: String,
    pub description: String,
    pub trigger: ActionTrigger,
    pub task: Value,
    pub variables: Vec<TemplateVariable>,
}

/// Rejected template input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TemplateInputError {
    #[error("a template description can be at most 1000 characters")]
    DescriptionTooLong,
    #[error("a template can have at most 100 variables")]
    TooManyVariables,
}

impl ShareRoutineTemplate {
    fn into_snapshot(self, action: &ScheduledAction, action_id: Uuid) -> Result<TemplateSnapshot> {
        if self.description.chars().count() > MAX_DESCRIPTION_CHARS {
            return Err(TemplateInputError::DescriptionTooLong.into());
        }
        if self.variables.len() > MAX_VARIABLES {
            return Err(TemplateInputError::TooManyVariables.into());
        }
        Ok(TemplateSnapshot {
            action_id,
            name: action.name.clone(),
            description: self.description.trim().to_owned(),
            trigger: action.trigger.clone(),
            task: action.task.clone(),
            variables: self.variables,
        })
    }
}

pub struct RoutineTemplateServiceImpl<Actions, Templates, Flags> {
    actions: Arc<Actions>,
    templates: Arc<Templates>,
    flags: Option<Flags>,
}

impl<Actions, Templates, Flags: FeatureFlags>
    RoutineTemplateServiceImpl<Actions, Templates, Flags>
{
    pub fn new(actions: Arc<Actions>, templates: Arc<Templates>, flags: Option<Flags>) -> Self {
        Self {
            actions,
            templates,
            flags,
        }
    }

    #[tracing::instrument(name = "routine.sharing_flag", err, skip_all)]
    async fn require_sharing(&self, user: Option<&MacroUserIdStr<'_>>) -> Result<()> {
        let (Some(flags), Some(user)) = (&self.flags, user) else {
            anyhow::bail!(ActionPolicyError::NotFound);
        };
        let enabled = flags
            .load(user)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    ?error,
                    "feature flags unavailable; routine sharing stays off"
                );
            })
            .is_ok_and(|snapshot| snapshot.is_enabled(ROUTINE_SHARING_FLAG));
        if !enabled {
            anyhow::bail!(ActionPolicyError::NotFound);
        }
        Ok(())
    }
}

impl<Actions: ScheduledActionService, Templates, Flags>
    RoutineTemplateServiceImpl<Actions, Templates, Flags>
{
    /// The routine behind an owner receipt, while the receipt's user still owns it.
    async fn owned_action(
        &self,
        receipt: &EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(Uuid, ScheduledAction)> {
        if receipt.entity().entity_type != EntityType::ScheduledAction {
            anyhow::bail!("scheduled action receipt has the wrong entity type");
        }
        let id = receipt
            .entity()
            .entity_id
            .parse::<Uuid>()
            .map_err(|_| ActionPolicyError::NotFound)?;
        let action = self.actions.get_action(id).await?;
        let owned = receipt
            .acting_user_id()
            .is_some_and(|user| action.owner.is_user(user));
        if !owned {
            return Err(ActionPolicyError::NotFound.into());
        }
        Ok((id, action))
    }
}

impl<Actions, Templates, Flags> RoutineTemplateService
    for RoutineTemplateServiceImpl<Actions, Templates, Flags>
where
    Actions: ScheduledActionService,
    Templates: RoutineTemplateRepo,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(err, skip_all, fields(action_id = %receipt.entity().entity_id, variables = input.variables.len()))]
    async fn share_template(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        input: ShareRoutineTemplate,
    ) -> Result<RoutineTemplate> {
        self.require_sharing(receipt.acting_user_id()).await?;
        let (id, action) = self.owned_action(&receipt).await?;
        action.owner_user()?;
        let snapshot = input.into_snapshot(&action, id)?;
        self.templates.upsert_template(snapshot).await
    }

    #[tracing::instrument(err, skip_all, fields(action_id = %receipt.entity().entity_id))]
    async fn unshare_template(&self, receipt: EntityAccessReceipt<OwnerAccessLevel>) -> Result<()> {
        let (id, _) = self.owned_action(&receipt).await?;
        self.templates.delete_template(&id).await
    }

    #[tracing::instrument(err, skip_all, fields(template_id = %id))]
    async fn get_template(&self, user: &MacroUserIdStr<'_>, id: Uuid) -> Result<RoutineTemplate> {
        self.require_sharing(Some(user)).await?;
        self.templates
            .get_template(&id)
            .await?
            .ok_or_else(|| ActionPolicyError::NotFound.into())
    }

    #[tracing::instrument(err, skip_all, fields(template_id = %template_id))]
    async fn activate_template(
        &self,
        principal: &CreationPrincipal,
        template_id: Uuid,
        input: CreateScheduledAction,
    ) -> Result<ScheduledAction> {
        self.require_sharing(principal.user()).await?;
        if self.templates.get_template(&template_id).await?.is_none() {
            return Err(ActionPolicyError::NotFound.into());
        }
        self.actions
            .create_action_from_template(principal, input, template_id)
            .await
    }
}
