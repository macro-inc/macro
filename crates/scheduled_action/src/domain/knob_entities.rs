//! The items a routine's entity knobs name, checked as its owner: on save,
//! so a routine never stores one they can't use, and before each code step
//! runs, so a deleted item or lost access fails that step plainly instead of
//! inside the code.

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use routine_program::{CodeStep, EntityKind, EntityValue};

use super::ports::KnobEntities;

#[cfg(test)]
pub(crate) mod test;

/// An entity knob whose item its owner can't use, or that has none picked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnusableItem {
    /// The step's title.
    pub step: String,
    /// The knob's label.
    pub label: String,
    /// The kind of item it names, or the first it allows when none is picked.
    pub kind: EntityKind,
    /// Whether an item is picked at all.
    pub picked: bool,
}

impl UnusableItem {
    /// Why saving refuses it.
    pub fn save_problem(&self) -> String {
        let (step, noun, label) = (&self.step, self.kind.noun(), &self.label);
        if self.picked {
            format!(
                "\"{step}\": the {noun} picked for \"{label}\" doesn't exist or you can't open it; pick another"
            )
        } else {
            format!("\"{step}\": pick a {noun} for \"{label}\"")
        }
    }

    /// Why its step failed, for the run's history.
    pub fn run_failure(&self) -> String {
        let (noun, label) = (self.kind.noun(), &self.label);
        if self.picked {
            format!(
                "The {noun} picked for \"{label}\" was deleted or you no longer have access to it. Pick another in the routine's settings."
            )
        } else {
            format!("No {noun} is picked for \"{label}\". Pick one in the routine's settings.")
        }
    }
}

/// The entity knobs of `steps` whose item `owner` can't use, or that have
/// none picked, in order. Each item is looked up once.
pub async fn unusable_items(
    entities: &dyn KnobEntities,
    owner: &MacroUserIdStr<'static>,
    steps: &[&CodeStep],
) -> Result<Vec<UnusableItem>, Report> {
    let mut usable: HashMap<&EntityValue, bool> = HashMap::new();
    let mut unusable = Vec::new();
    for step in steps {
        for (label, item, kinds) in step.entities() {
            let Some(item) = item else {
                // Validation guarantees at least one kind.
                let kind = kinds.first().copied().unwrap_or(EntityKind::Channel);
                unusable.push(UnusableItem {
                    step: step.title.trim().to_owned(),
                    label: label.trim().to_owned(),
                    kind,
                    picked: false,
                });
                continue;
            };
            let ok = match usable.get(item) {
                Some(ok) => *ok,
                None => {
                    let ok = entities.usable(owner, item).await?;
                    usable.insert(item, ok);
                    ok
                }
            };
            if !ok {
                unusable.push(UnusableItem {
                    step: step.title.trim().to_owned(),
                    label: label.trim().to_owned(),
                    kind: item.kind,
                    picked: true,
                });
            }
        }
    }
    Ok(unusable)
}
