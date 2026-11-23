//! The items a routine's entity knobs name, checked as its owner: on save,
//! so a routine never stores one they can't use; in a run, when the first
//! code step that uses one starts, so a deleted item or lost access fails
//! that step plainly instead of inside the code; and for the routine's page,
//! so its owner sees which knobs need a new pick.

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use routine_program::{CodeStep, EntityKind, EntityValue, RoutineProgram, StepId};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::ports::KnobEntities;

#[cfg(test)]
pub(crate) mod test;

/// An entity knob whose item its owner can't use, or that has none picked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnusableItem {
    /// Which of the steps checked it is in, by position.
    pub position: usize,
    /// The step's title.
    pub step: String,
    /// The knob's name.
    pub knob: String,
    /// The knob's label.
    pub label: String,
    /// The kind of item it names. With none picked, the one kind the knob
    /// allows, or none when it allows several.
    pub kind: Option<EntityKind>,
    /// The item picked, which can't be used; none when nothing is picked.
    pub item: Option<EntityValue>,
}

impl UnusableItem {
    fn noun(&self) -> &'static str {
        self.kind.map_or("item", EntityKind::noun)
    }

    /// Why saving refuses it.
    pub fn save_problem(&self) -> String {
        let (step, noun, label) = (&self.step, self.noun(), &self.label);
        if self.item.is_some() {
            format!(
                "\"{step}\": the {noun} picked for \"{label}\" doesn't exist or you can't open it; pick another"
            )
        } else {
            format!("\"{step}\": pick {} {noun} for \"{label}\"", article(noun))
        }
    }

    /// Why its step failed, for the run's history and the routine's page.
    pub fn run_failure(&self) -> String {
        let (noun, label) = (self.noun(), &self.label);
        if self.item.is_some() {
            format!(
                "The {noun} picked for \"{label}\" was deleted or you no longer have access to it. Pick another in the routine's settings."
            )
        } else {
            format!("No {noun} is picked for \"{label}\". Pick one in the routine's settings.")
        }
    }
}

/// `a` or `an`, as `noun` starts.
fn article(noun: &str) -> &'static str {
    match noun.chars().next() {
        Some('a' | 'e' | 'i' | 'o' | 'u') => "an",
        _ => "a",
    }
}

/// The entity knobs of `steps` whose item `owner` can't use, or that have
/// none picked, in order. Each item is looked up once.
pub async fn unusable_items(
    entities: &dyn KnobEntities,
    owner: &MacroUserIdStr<'static>,
    steps: &[&CodeStep],
) -> Result<Vec<UnusableItem>, Report> {
    unusable_items_known(entities, owner, steps, &mut HashMap::new()).await
}

/// [`unusable_items`], taking whether an item is usable from `known` when it
/// was looked up already, and adding each item it looks up. A run passes one
/// map to every step, so an item several steps pick is looked up once a run.
pub async fn unusable_items_known<'a>(
    entities: &dyn KnobEntities,
    owner: &MacroUserIdStr<'static>,
    steps: &[&'a CodeStep],
    known: &mut HashMap<&'a EntityValue, bool>,
) -> Result<Vec<UnusableItem>, Report> {
    let mut unusable = Vec::new();
    for (position, &step) in steps.iter().enumerate() {
        for (knob, item, kinds) in step.entities() {
            let unusable_item = |kind, item: Option<&EntityValue>| UnusableItem {
                position,
                step: step.title.trim().to_owned(),
                knob: knob.name().to_string(),
                label: knob.label().trim().to_owned(),
                kind,
                item: item.cloned(),
            };
            let Some(item) = item else {
                let kind = match kinds {
                    [kind] => Some(*kind),
                    _ => None,
                };
                unusable.push(unusable_item(kind, None));
                continue;
            };
            let ok = match known.get(item) {
                Some(ok) => *ok,
                None => {
                    let ok = entities.usable(owner, item).await?;
                    known.insert(item, ok);
                    ok
                }
            };
            if !ok {
                unusable.push(unusable_item(Some(item.kind), Some(item)));
            }
        }
    }
    Ok(unusable)
}

/// An entity knob of a saved routine whose item needs a new pick: it was
/// deleted, its owner lost access, or none is picked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UnusableKnob {
    /// Its step's id. A step saved before steps had ids has none until it is
    /// saved again; a client can't place that one, but its run still fails.
    pub step: Option<StepId>,
    /// The knob's name.
    pub knob: String,
    /// The item picked, which needs another; none when nothing is picked.
    pub item: Option<EntityValue>,
    /// Why it can't be used, for the routine's owner.
    pub reason: String,
}

/// The entity knobs of `program` whose item `owner` can't use now, each with
/// its step's id, which stays the step's while the routine is edited around it.
#[tracing::instrument(name = "routine.unusable_knobs", err, skip_all, fields(
    items = tracing::field::Empty,
    unusable = tracing::field::Empty,
))]
pub async fn unusable_knobs(
    entities: &dyn KnobEntities,
    owner: &MacroUserIdStr<'static>,
    program: &RoutineProgram,
) -> Result<Vec<UnusableKnob>, Report> {
    let steps = program.code_steps();
    let span = tracing::Span::current();
    span.record(
        "items",
        steps
            .iter()
            .map(|step| step.entities().count())
            .sum::<usize>(),
    );
    let unusable = unusable_items(entities, owner, &steps).await?;
    span.record("unusable", unusable.len());
    Ok(unusable
        .into_iter()
        .map(|item| UnusableKnob {
            step: steps.get(item.position).and_then(|step| step.id.clone()),
            reason: item.run_failure(),
            knob: item.knob,
            item: item.item,
        })
        .collect())
}
