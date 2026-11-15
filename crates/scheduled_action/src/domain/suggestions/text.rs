//! How a drafted routine reads on its suggestion's card in the Suggestions
//! feed: its sentence, with the values AI picked marked, and when it runs.

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use routine_program::{RoutineProgram, sentence_runs};
use suggestions::domain::model::{RoutineSentencePart, RoutineText};

use crate::domain::models::ActionConfiguration;

#[cfg(test)]
mod test;

/// `routine` as its card reads it, with a one-off time in `zone`. Its
/// sentence is that of its first code step whose sentence reads, as the
/// routine editor shows it; else its description (else its name) as one
/// unpicked part.
pub fn routine_text(routine: &ActionConfiguration, zone: Tz, now: DateTime<Utc>) -> RoutineText {
    let runs = RoutineProgram::from_task(&routine.task)
        .ok()
        .and_then(|program| {
            program.code_steps().into_iter().find_map(|step| {
                let sentence = step.sentence.as_deref().filter(|s| !s.trim().is_empty())?;
                sentence_runs(sentence, &step.knobs)
            })
        });
    let sentence = match runs {
        Some(runs) => runs
            .into_iter()
            .map(|run| RoutineSentencePart {
                text: run.text,
                picked: run.knob,
            })
            .collect(),
        None => {
            let words = match routine.description.trim() {
                "" => routine.name.trim(),
                description => description,
            };
            vec![RoutineSentencePart {
                text: words.to_owned(),
                picked: false,
            }]
        }
    };
    RoutineText {
        sentence,
        when: routine.trigger.describe(zone, now),
    }
}
