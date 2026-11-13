//! How far a draft has got, for a person waiting on one in the background.
//! The drafter reports milestones as it reaches them; a draft run in the
//! request that waits for it reports to [`Unreported`], which keeps nothing.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use super::StepKind;
use super::direct::ItemKind;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::RoutineCheck;

#[cfg(test)]
mod test;

/// Where the drafter reports how far it has got. Reporting never waits:
/// whoever keeps the progress does its writing elsewhere.
pub trait DraftProgress: Send + Sync {
    fn report(&self, milestone: DraftMilestone);
}

/// Keeps no progress: a draft whose request waits for its answer.
pub struct Unreported;

impl DraftProgress for Unreported {
    fn report(&self, _: DraftMilestone) {}
}

/// Something the drafter reached.
#[derive(Debug, Clone, PartialEq)]
pub enum DraftMilestone {
    /// The items the person’s words name were looked up, before the
    /// model writes: which were found, and which are left for them to pick.
    Found(FoundNames),
    /// The model is writing: the session's prompt was accepted, so its
    /// usage was admitted.
    Writing,
    /// The session handed a routine back by checking it.
    Checked(CheckSummary),
    /// That check failed, so the model goes again.
    Fixing,
}

/// The stage a draft is at.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DraftStage {
    /// Started; nothing reported yet.
    #[default]
    Started,
    /// The items its words name were looked up.
    Found,
    /// The model is writing it.
    Writing,
    /// It handed a routine back; its `check` says whether it passed.
    Checked,
    /// The routine it handed back failed its check, and it is fixing it.
    Fixing,
}

/// How far a draft has got: its latest stage, and what it reported on the
/// way.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftJobProgress {
    pub stage: DraftStage,
    /// How many items the words name were found; absent before they were
    /// looked up.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub found: Option<u32>,
    /// Which items the words name were found, and which are left for the
    /// person to pick; absent before they were looked up.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub names: Option<FoundNames>,
    /// The latest routine handed back; absent before the first check.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<CheckSummary>,
}

impl DraftJobProgress {
    /// The progress once `milestone` is reached.
    pub fn reach(&mut self, milestone: DraftMilestone) {
        match milestone {
            DraftMilestone::Found(names) => {
                self.stage = DraftStage::Found;
                self.found = Some(u32::try_from(names.found.len()).unwrap_or(u32::MAX));
                self.names = Some(names);
            }
            DraftMilestone::Writing => self.stage = DraftStage::Writing,
            DraftMilestone::Checked(check) => {
                self.stage = DraftStage::Checked;
                self.check = Some(check);
            }
            DraftMilestone::Fixing => self.stage = DraftStage::Fixing,
        }
    }
}

/// The items a draft's words name, as the drafter looked them up by name.
/// Names only, as the person wrote them or the items are called: never
/// ids.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoundNames {
    /// Each the only item of its kinds with the name the words use.
    pub found: Vec<FoundName>,
    /// Names no item has, or several do: the draft leaves them out for the
    /// person to pick.
    pub left: Vec<LeftName>,
}

/// An item found by the name the words use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoundName {
    /// Its name as stored.
    pub name: String,
    pub kind: ItemKind,
}

/// A name the words use that the drafter couldn't settle on one item for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LeftName {
    /// The name as the words use it.
    pub name: String,
    /// The kind it most likely names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ItemKind>,
    /// How many items have it: none, or several.
    pub matches: u32,
}

/// A routine the session handed back, as a person watching reads it: never
/// its code.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckSummary {
    /// How many checks the session made so far, this one included.
    pub checks: u32,
    /// Whether it passed.
    pub ok: bool,
    /// How many problems it has, its code's included.
    pub problems: u32,
    pub name: String,
    /// When it would run.
    pub trigger: ActionTrigger,
    /// Its steps, in order.
    pub steps: Vec<StepTitle>,
}

/// A step of a routine handed back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StepTitle {
    pub kind: StepKind,
    /// Its title; empty when it has none.
    pub title: String,
}

impl CheckSummary {
    /// `check`, the session's `checks`th.
    pub fn of(check: &RoutineCheck, checks: u32) -> Self {
        let problems = check.problems.len()
            + check
                .steps
                .iter()
                .map(|step| step.problems.len().max(1))
                .sum::<usize>();
        let steps = check
            .routine
            .task
            .get("steps")
            .and_then(Value::as_array)
            .map(|steps| {
                steps
                    .iter()
                    .map(|step| StepTitle {
                        kind: match step.get("type").and_then(Value::as_str) {
                            Some("agent") => StepKind::Agent,
                            _ => StepKind::Code,
                        },
                        title: step
                            .get("title")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim()
                            .to_owned(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self {
            checks,
            ok: check.ok,
            problems: u32::try_from(problems).unwrap_or(u32::MAX),
            name: check.routine.name.trim().to_owned(),
            trigger: check.routine.trigger.clone(),
            steps,
        }
    }
}
