//! Loading the labeled evaluation corpus, plus small per-task helpers.
//!
//! The corpus is [`EvalCorpus`] JSON merged from committed fixtures:
//! - two read-only snapshots of real employee tasks — a title-only set
//!   (`prod_title_only.json`) and a with-body set (`prod_with_body.json`), both
//!   screened for sensitive content and email-anonymized;
//! - labeled pairs over those tasks: hand-picked (`prod_pairs.json`),
//!   model-mined-then-verified (`prod_mined_pairs.json`), and an intentional
//!   look-alike hard-negative batch (`prod_hard_negatives.json` +
//!   `prod_hard_negative_pairs.json`);
//! - synthetic labeled pairs pinning the canonical cases: hand-authored
//!   (`synthetic.json`) and model-generated-then-verified
//!   (`synthetic_generated.json`);
//! - hand-authored non-rephrasing positives (`synthetic_hard_positives.json`):
//!   terse-title vs detailed writeup, and same-work/low-lexical-overlap pairs,
//!   so recall is measured on more than paraphrases.

use std::collections::HashMap;

use embedding::entity::Task;
use task_dedup::eval::{CorpusTask, EvalCorpus, TaskSource};

/// Loads and merges the committed fixtures into one corpus, panicking if any
/// labeled pair references a task that is missing.
pub fn load_corpus() -> EvalCorpus {
    let mut corpus =
        EvalCorpus::from_json(include_bytes!("../../fixtures/eval/prod_title_only.json"))
            .expect("prod_title_only.json parses");
    for bytes in [
        include_bytes!("../../fixtures/eval/prod_with_body.json").as_slice(),
        include_bytes!("../../fixtures/eval/prod_pairs.json").as_slice(),
        include_bytes!("../../fixtures/eval/prod_mined_pairs.json").as_slice(),
        include_bytes!("../../fixtures/eval/prod_hard_negatives.json").as_slice(),
        include_bytes!("../../fixtures/eval/prod_hard_negative_pairs.json").as_slice(),
        include_bytes!("../../fixtures/eval/synthetic.json").as_slice(),
        include_bytes!("../../fixtures/eval/synthetic_generated.json").as_slice(),
        include_bytes!("../../fixtures/eval/synthetic_hard_positives.json").as_slice(),
    ] {
        corpus.merge(EvalCorpus::from_json(bytes).expect("fixture parses"));
    }

    let dangling = corpus.dangling_pair_ids();
    assert!(
        dangling.is_empty(),
        "labeled pairs reference missing tasks: {dangling:?}"
    );
    corpus
}

/// Maps each corpus task id to the document id it is seeded under.
///
/// Prod tasks keep their real UUID; synthetic tasks (readable slugs in the
/// fixture) are seeded under a generated UUID-shaped id. This matters because
/// the `task_duplicate_match_order` CHECK (`task_id < duplicate_task_id`) is
/// evaluated in the database's collation, while the service's `ordered_pair`
/// uses Rust byte ordering — the two disagree on strings with hyphens in
/// non-aligned positions (e.g. `syn-attach-drag-files` vs `syn-attach-dragdrop`).
/// Real document ids are UUIDs, whose hyphens always align, so production never
/// hits this; seeding UUID-shaped ids keeps the eval faithful to that.
pub fn seed_ids(corpus: &EvalCorpus) -> HashMap<String, String> {
    corpus
        .tasks
        .iter()
        .enumerate()
        .map(|(index, task)| {
            let doc_id = match task.source {
                TaskSource::Prod => task.id.clone(),
                TaskSource::Synthetic => format!("e5a10000-0000-4000-8000-{index:012x}"),
            };
            (task.id.clone(), doc_id)
        })
        .collect()
}

/// Joins a task's title and body the same way the service builds its judge /
/// rerank query, so isolated judge calls see exactly what the pipeline would.
pub fn full_text(title: &str, body: &str) -> String {
    format!("{}\n{}", title.trim(), body.trim())
}

/// Borrows a corpus task as an embeddable entity (title + body fields).
pub fn embeddable(task: &CorpusTask) -> Task<'_> {
    Task {
        title: std::borrow::Cow::Borrowed(&task.title),
        body: std::borrow::Cow::Borrowed(&task.body),
    }
}
