//! The evaluation corpus data model.
//!
//! An [`EvalCorpus`] is a flat list of [`CorpusTask`]s plus a list of
//! [`LabeledPair`]s referencing them by id. It serializes to JSON so a corpus
//! can be committed as a fixture, hand-edited, or produced by the prod puller
//! and merged with the synthetic set.

use serde::{Deserialize, Serialize};

/// Where a corpus task came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskSource {
    /// Pulled from a real production task created by a Macro employee.
    Prod,
    /// Hand-authored or generated synthetic task.
    Synthetic,
}

/// A single task in the evaluation corpus.
///
/// `id` is a stable local identifier, not necessarily a real document id: the
/// seeding step inserts each task under this id so labeled pairs can reference
/// it. Prod snapshots use their real (opaque) document ids; synthetic tasks use
/// readable slugs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorpusTask {
    /// Stable identifier used as the seeded document id.
    pub id: String,
    /// Task title (`Document.name`).
    pub title: String,
    /// Task body as lexical embedding-format markdown. Often empty — many real
    /// tasks are title-only.
    #[serde(default)]
    pub body: String,
    /// Where the task came from.
    pub source: TaskSource,
    /// Raw task property values as stored in `entity_properties`, retained for
    /// the follow-up property-embedding work. The current pipeline embeds only
    /// title and body, so this is carried but not consumed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub properties: Option<serde_json::Value>,
}

/// The category a labeled pair exercises.
///
/// These mirror the cases called out in the dedup spec: the ones that must be
/// caught (`Rephrasing`) and the ones that must *not* be flagged
/// (`SameProjectDifferentAction`, `SameActionDifferentIntegration`), plus catch-alls
/// for real observed pairs and obvious negatives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairCase {
    /// Two rephrasings of the same underlying work — expected duplicate.
    Rephrasing,
    /// Same project or feature area, but a different action — expected NOT a
    /// duplicate.
    SameProjectDifferentAction,
    /// Same action applied to a different integration/surface (e.g. the same
    /// change wired into two services) — expected NOT a duplicate.
    SameActionDifferentIntegration,
    /// A pair drawn from the real prod snapshot and hand-labeled.
    ProdObserved,
    /// Two entirely unrelated tasks — expected NOT a duplicate.
    Unrelated,
}

impl PairCase {
    /// A short human-readable label for reports.
    pub fn label(self) -> &'static str {
        match self {
            PairCase::Rephrasing => "rephrasing",
            PairCase::SameProjectDifferentAction => "same_project_different_action",
            PairCase::SameActionDifferentIntegration => "same_action_different_integration",
            PairCase::ProdObserved => "prod_observed",
            PairCase::Unrelated => "unrelated",
        }
    }
}

/// A labeled task pair with the ground-truth duplicate verdict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabeledPair {
    /// First task id (references [`CorpusTask::id`]).
    pub a: String,
    /// Second task id (references [`CorpusTask::id`]).
    pub b: String,
    /// Ground truth: whether the two tasks are duplicates.
    pub expected_duplicate: bool,
    /// The category this pair exercises.
    pub case: PairCase,
    /// Optional note explaining the label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// A full evaluation corpus: tasks plus labeled pairs over them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EvalCorpus {
    /// All tasks referenced by the pairs.
    pub tasks: Vec<CorpusTask>,
    /// Labeled task pairs.
    #[serde(default)]
    pub pairs: Vec<LabeledPair>,
}

impl EvalCorpus {
    /// Parses a corpus from JSON bytes.
    pub fn from_json(bytes: &[u8]) -> serde_json::Result<Self> {
        serde_json::from_slice(bytes)
    }

    /// Serializes the corpus to pretty JSON.
    pub fn to_json(&self) -> serde_json::Result<String> {
        serde_json::to_string_pretty(self)
    }

    /// Appends another corpus's tasks and pairs to this one.
    pub fn merge(&mut self, other: EvalCorpus) {
        self.tasks.extend(other.tasks);
        self.pairs.extend(other.pairs);
    }

    /// Looks up a task by id.
    pub fn task(&self, id: &str) -> Option<&CorpusTask> {
        self.tasks.iter().find(|task| task.id == id)
    }

    /// Returns the ids referenced by a pair that are missing from `tasks`.
    ///
    /// A non-empty result means the corpus is internally inconsistent (a pair
    /// points at a task that was not included).
    pub fn dangling_pair_ids(&self) -> Vec<String> {
        let mut missing = Vec::new();
        for pair in &self.pairs {
            for id in [&pair.a, &pair.b] {
                if self.task(id).is_none() {
                    missing.push(id.clone());
                }
            }
        }
        missing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str) -> CorpusTask {
        CorpusTask {
            id: id.to_string(),
            title: format!("{id} title"),
            body: String::new(),
            source: TaskSource::Synthetic,
            properties: None,
        }
    }

    #[test]
    fn round_trips_through_json() {
        let corpus = EvalCorpus {
            tasks: vec![task("a"), task("b")],
            pairs: vec![LabeledPair {
                a: "a".to_string(),
                b: "b".to_string(),
                expected_duplicate: true,
                case: PairCase::Rephrasing,
                note: Some("same work".to_string()),
            }],
        };

        let json = corpus.to_json().unwrap();
        let parsed = EvalCorpus::from_json(json.as_bytes()).unwrap();

        assert_eq!(parsed.tasks.len(), 2);
        assert_eq!(parsed.pairs.len(), 1);
        assert!(parsed.pairs[0].expected_duplicate);
        assert_eq!(parsed.pairs[0].case, PairCase::Rephrasing);
    }

    #[test]
    fn detects_dangling_pair_ids() {
        let corpus = EvalCorpus {
            tasks: vec![task("a")],
            pairs: vec![LabeledPair {
                a: "a".to_string(),
                b: "missing".to_string(),
                expected_duplicate: false,
                case: PairCase::Unrelated,
                note: None,
            }],
        };

        assert_eq!(corpus.dangling_pair_ids(), vec!["missing".to_string()]);
    }
}
