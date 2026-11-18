//! A routine appearance write and its history policy.

use activity::{Activity, AppearanceUpdate, Attribution};
use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use model_entity::{AppearanceIcon, EntityAppearance, EntityType};

use super::models::ActionPolicyError;

/// An authorized appearance replacement, persisted together with its history.
pub struct ChangeAppearance {
    /// Routine identity.
    pub id: Uuid,
    /// Replacement overrides.
    pub appearance: EntityAppearance,
    /// Whose choice it is, which decides whether it replaces the stored one.
    pub chooser: AppearanceChooser,
    /// Principal responsible for the change.
    pub attribution: Attribution,
    /// Stable identity for the history event of this write.
    pub event_id: Uuid,
    /// When the change was requested.
    pub occurred_at: DateTime<Utc>,
}

/// Whose choice a routine's appearance is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppearanceChooser {
    /// The owner's, through the appearance endpoint, themselves or by asking
    /// an agent for that look. Always stored, and from then on kept, even
    /// when it is no icon.
    Owner,
    /// An agent's pick for what the routine does, made with a routine it
    /// drafts or changes. Stored only while the owner hasn't chosen one.
    Agent,
}

impl ChangeAppearance {
    /// Record actual stored transitions only; repeated writes have no history.
    pub fn activity(&self, previous: &EntityAppearance) -> Option<Activity> {
        AppearanceUpdate {
            appearance: self.appearance.clone(),
            attribution: Some(self.attribution.clone()),
            event_id: self.event_id,
            occurred_at: self.occurred_at,
        }
        .activity(EntityType::ScheduledAction, self.id.to_string(), previous)
    }
}

/// Refuse an agent's pick saving would refuse, saying why for the agent that
/// made it: an icon name not in Macro's catalog comes with the names it may
/// use.
pub fn check_pick(pick: &EntityAppearance) -> Result<(), ActionPolicyError> {
    let Err(problem) = pick.validate() else {
        return Ok(());
    };
    let problem = match &pick.icon {
        Some(AppearanceIcon::Macro { name }) => format!(
            "The appearance's icon {name:?} is not a Macro icon. Use one of: {}.",
            model_entity::macro_icon_names().join(", ")
        ),
        _ => format!("The appearance's icon is not one emoji: {problem}."),
    };
    Err(ActionPolicyError::InvalidAppearance(problem))
}
