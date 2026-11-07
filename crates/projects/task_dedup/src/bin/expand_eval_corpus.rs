//! Grows the semantic-eval labeled set, two ways, both label-verified.
//!
//! The eval is only as trustworthy as its ground-truth labels, so every pair
//! this tool emits is checked by an independent model before it is kept: a
//! strong *oracle* (Opus) proposes pairs, a different *verifier* (Sonnet)
//! re-judges duplicate-vs-not, and a pair is kept only when the verifier agrees
//! with its by-construction / proposed label. The judge actually under test in
//! the eval is Haiku, so it is deliberately not in this loop.
//!
//! Subcommands:
//! - `generate` — the oracle synthesizes fresh synthetic task pairs for each
//!   scenario (rephrasing → duplicate; same-project-different-action,
//!   same-action-different-integration, unrelated → not). Writes tasks + pairs
//!   to a `synthetic_generated.json` fixture.
//! - `mine` — the oracle scans the committed real-task snapshots
//!   (`prod_title_only.json` + `prod_with_body.json`) for pairs that already
//!   exist in the data and fit each scenario, referencing tasks by id. Writes a
//!   pairs-only `prod_mined_pairs.json` fixture. No production access — it reads
//!   the already-anonymized fixtures, so it is fully reproducible.
//!
//! Both run entirely on model calls + local files. Usage:
//! ```text
//! cargo run -p task_dedup --features backfill --bin expand_eval_corpus -- generate \
//!   --per-scenario 8 --out crates/task_dedup/fixtures/eval/synthetic_generated.json
//! cargo run -p task_dedup --features backfill --bin expand_eval_corpus -- mine \
//!   --prod crates/task_dedup/fixtures/eval/prod_title_only.json \
//!   --prod crates/task_dedup/fixtures/eval/prod_with_body.json \
//!   --out  crates/task_dedup/fixtures/eval/prod_mined_pairs.json
//! ```
//! Requires `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CEREBRAS_API_KEY` (the
//! agent router).

use std::path::PathBuf;
use std::sync::Arc;

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use anyhow::{Context as _, Result};
use clap::{Parser, Subcommand};
use futures::StreamExt;
use serde_json::json;
use task_dedup::eval::{CorpusTask, EvalCorpus, LabeledPair, PairCase, TaskSource};

/// The model that proposes pairs. Strong, so proposals are high quality.
const ORACLE: PredefinedModel = PredefinedModel::Smart;
/// The model that verifies labels. Different from the oracle (independent) and
/// from the Haiku judge under test.
const VERIFIER: PredefinedModel = PredefinedModel::Sonnet4_6;

/// One duplicate-detection scenario the corpus must cover.
struct Scenario {
    case: PairCase,
    /// The ground-truth label pairs in this scenario carry.
    expected_duplicate: bool,
    /// Short key used in generated ids and prompts.
    key: &'static str,
    /// What the scenario means, shown to the oracle and verifier.
    definition: &'static str,
}

const SCENARIOS: [Scenario; 4] = [
    Scenario {
        case: PairCase::Rephrasing,
        expected_duplicate: true,
        key: "rephrasing",
        definition: "Two tasks that describe the SAME underlying work — completing one would substantially complete the other — but worded differently (different title, phrasing, or terse-vs-verbose). These ARE duplicates.",
    },
    Scenario {
        case: PairCase::SameProjectDifferentAction,
        expected_duplicate: false,
        key: "same_project_different_action",
        definition: "Two tasks in the SAME feature area / project but describing DIFFERENT actions or deliverables (e.g. both about search, but one is ranking and one is pagination). These are NOT duplicates.",
    },
    Scenario {
        case: PairCase::SameActionDifferentIntegration,
        expected_duplicate: false,
        key: "same_action_different_integration",
        definition: "The SAME action applied to a DIFFERENT integration, service, or surface (e.g. 'use new config: service A' vs 'service B', or 'add OAuth for Google' vs 'for Microsoft'). Distinct work, often assigned to different people. These are NOT duplicates.",
    },
    Scenario {
        case: PairCase::Unrelated,
        expected_duplicate: false,
        key: "unrelated",
        definition: "Two tasks from entirely different areas with no meaningful overlap. These are NOT duplicates.",
    },
];

#[derive(Parser, Debug)]
#[command(name = "expand_eval_corpus", about, long_about = None)]
struct Args {
    #[command(subcommand)]
    command: Command,
    /// Model calls to run concurrently.
    #[arg(long, default_value_t = 6, global = true)]
    concurrency: usize,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Synthesize fresh synthetic task pairs for each scenario.
    Generate {
        /// Target pairs per scenario (before verification drops mismatches).
        #[arg(long, default_value_t = 8)]
        per_scenario: usize,
        /// Output fixture path.
        #[arg(long)]
        out: PathBuf,
    },
    /// Mine committed real-task snapshots for pairs fitting each scenario.
    Mine {
        /// Prod snapshot fixture(s) to mine (repeatable).
        #[arg(long = "prod", required = true)]
        prod: Vec<PathBuf>,
        /// Max candidate pairs to request per scenario.
        #[arg(long, default_value_t = 8)]
        per_scenario: usize,
        /// Output fixture path (pairs only).
        #[arg(long)]
        out: PathBuf,
    },
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/// No-op usage recorder: this tool must not write ai_usage rows anywhere.
struct NoopRecorder;
impl ai_usage::UsageRecorder for NoopRecorder {
    fn record(&self, _event: ai_usage::UsageEvent) {}
}

static VERIFY_PROMPT: &str = r#"You decide whether two software tasks are DUPLICATES.

Duplicate means completing one task would substantially complete the other, with no major additional decisions or work — same user-visible outcome and same primary behavior, even if worded differently.

NOT a duplicate when the tasks merely share a feature area, affect the same entity via different behaviors, apply the same action to different integrations/services, or are otherwise separate deliverables.

Judge strictly on whether the same single unit of work completes both."#;

/// Independently re-judges whether two task texts are duplicates. Returns `None`
/// if the model call fails (the pair is then dropped, not guessed).
async fn verify_is_duplicate(
    recorder: &dyn ai_usage::UsageRecorder,
    a: &str,
    b: &str,
) -> Option<bool> {
    let schema = DynamicSchema {
        name: "DuplicateVerdict".to_string(),
        description: Some("Whether two tasks are duplicates.".to_string()),
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["is_duplicate"],
            "properties": { "is_duplicate": { "type": "boolean" } }
        }),
    };
    let value = dynamic_structured_completion(
        VERIFIER,
        VERIFY_PROMPT,
        vec![Message::user(format!("Task A:\n{a}\n\nTask B:\n{b}"))],
        schema,
        recorder,
        ai_usage::UsageContext::system(ai_usage::AiFeature::Automation),
    )
    .await
    .ok()?;
    value
        .get("is_duplicate")
        .and_then(serde_json::Value::as_bool)
}

fn full_text(title: &str, body: &str) -> String {
    format!("{}\n{}", title.trim(), body.trim())
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

async fn run_generate(
    recorder: Arc<NoopRecorder>,
    concurrency: usize,
    per_scenario: usize,
    out: PathBuf,
) -> Result<()> {
    let mut tasks: Vec<CorpusTask> = Vec::new();
    let mut pairs: Vec<LabeledPair> = Vec::new();

    for scenario in &SCENARIOS {
        let proposed = propose_synthetic(recorder.as_ref(), scenario, per_scenario).await?;
        println!("[generate] {}: proposed {}", scenario.key, proposed.len());

        // Verify each proposed pair's label independently, concurrently.
        let verified: Vec<Option<(SynthPair, bool)>> = futures::stream::iter(proposed)
            .map(|pair| {
                let recorder = recorder.clone();
                async move {
                    let verdict = verify_is_duplicate(
                        recorder.as_ref(),
                        &full_text(&pair.a_title, &pair.a_body),
                        &full_text(&pair.b_title, &pair.b_body),
                    )
                    .await?;
                    Some((pair, verdict))
                }
            })
            .buffer_unordered(concurrency)
            .collect()
            .await;

        let mut kept = 0usize;
        for (index, item) in verified.into_iter().flatten().enumerate() {
            let (pair, verdict) = item;
            if verdict != scenario.expected_duplicate {
                continue; // verifier disagrees with the by-construction label — drop.
            }
            let a_id = format!("gen-{}-{index}-a", scenario.key);
            let b_id = format!("gen-{}-{index}-b", scenario.key);
            tasks.push(synth_task(&a_id, &pair.a_title, &pair.a_body));
            tasks.push(synth_task(&b_id, &pair.b_title, &pair.b_body));
            pairs.push(LabeledPair {
                a: a_id,
                b: b_id,
                expected_duplicate: scenario.expected_duplicate,
                case: scenario.case,
                note: Some(format!("generated + verified ({})", scenario.key)),
            });
            kept += 1;
        }
        println!(
            "[generate] {}: kept {kept} after verification",
            scenario.key
        );
    }

    write_corpus(&out, EvalCorpus { tasks, pairs })
}

/// A synthetic pair proposed by the oracle.
struct SynthPair {
    a_title: String,
    a_body: String,
    b_title: String,
    b_body: String,
}

fn synth_task(id: &str, title: &str, body: &str) -> CorpusTask {
    CorpusTask {
        id: id.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        owner: None,
        source: TaskSource::Synthetic,
        properties: None,
    }
}

async fn propose_synthetic(
    recorder: &dyn ai_usage::UsageRecorder,
    scenario: &Scenario,
    count: usize,
) -> Result<Vec<SynthPair>> {
    let system = format!(
        "You author realistic software-engineering task pairs for a duplicate-detection test set. \
         Tasks look like real product/eng backlog items (bugs, features, refactors, infra, UI). \
         Vary the domains widely across pairs. Each task has a concise title and a 1-2 sentence body.\n\n\
         Produce pairs for this scenario:\n{}",
        scenario.definition
    );
    let schema = DynamicSchema {
        name: "TaskPairs".to_string(),
        description: Some("A list of task pairs for the scenario.".to_string()),
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["pairs"],
            "properties": {
                "pairs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["a_title", "a_body", "b_title", "b_body"],
                        "properties": {
                            "a_title": {"type": "string"},
                            "a_body": {"type": "string"},
                            "b_title": {"type": "string"},
                            "b_body": {"type": "string"}
                        }
                    }
                }
            }
        }),
    };
    let value = dynamic_structured_completion(
        ORACLE,
        &system,
        vec![Message::user(format!(
            "Generate {count} distinct, varied pairs."
        ))],
        schema,
        recorder,
        ai_usage::UsageContext::system(ai_usage::AiFeature::Automation),
    )
    .await?;

    Ok(value
        .get("pairs")
        .and_then(serde_json::Value::as_array)
        .map(|pairs| {
            pairs
                .iter()
                .filter_map(|pair| {
                    Some(SynthPair {
                        a_title: pair.get("a_title")?.as_str()?.to_string(),
                        a_body: pair.get("a_body")?.as_str()?.to_string(),
                        b_title: pair.get("b_title")?.as_str()?.to_string(),
                        b_body: pair.get("b_body")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

// ---------------------------------------------------------------------------
// mine
// ---------------------------------------------------------------------------

async fn run_mine(
    recorder: Arc<NoopRecorder>,
    concurrency: usize,
    prod_paths: Vec<PathBuf>,
    per_scenario: usize,
    out: PathBuf,
) -> Result<()> {
    // Load the committed real-task snapshots (already anonymized).
    let mut corpus = EvalCorpus::default();
    for path in &prod_paths {
        let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
        corpus.merge(
            EvalCorpus::from_json(&bytes).with_context(|| format!("parse {}", path.display()))?,
        );
    }
    println!("[mine] loaded {} real tasks", corpus.tasks.len());

    // Compact catalog for the oracle: id + title + short body.
    let catalog = corpus
        .tasks
        .iter()
        .map(|task| {
            let body = task.body.replace('\n', " ");
            let body = body.trim();
            let snippet = if body.is_empty() {
                String::new()
            } else {
                format!(" | {}", body.chars().take(160).collect::<String>())
            };
            format!("{}\t{}{}", task.id, task.title, snippet)
        })
        .collect::<Vec<_>>()
        .join("\n");

    let mut candidates: Vec<(String, String, PairCase, bool)> = Vec::new();
    for scenario in &SCENARIOS {
        let proposed = propose_mined(recorder.as_ref(), scenario, per_scenario, &catalog).await?;
        println!("[mine] {}: proposed {}", scenario.key, proposed.len());
        for (a, b) in proposed {
            // Keep only pairs referencing real, distinct tasks.
            if a != b && corpus.task(&a).is_some() && corpus.task(&b).is_some() {
                candidates.push((a, b, scenario.case, scenario.expected_duplicate));
            }
        }
    }

    // Verify each candidate's label independently.
    let verified: Vec<Option<LabeledPair>> = futures::stream::iter(candidates)
        .map(|(a, b, case, expected)| {
            let recorder = recorder.clone();
            let corpus = &corpus;
            async move {
                let task_a = corpus.task(&a)?;
                let task_b = corpus.task(&b)?;
                let verdict = verify_is_duplicate(
                    recorder.as_ref(),
                    &full_text(&task_a.title, &task_a.body),
                    &full_text(&task_b.title, &task_b.body),
                )
                .await?;
                if verdict != expected {
                    return None;
                }
                Some(LabeledPair {
                    a,
                    b,
                    expected_duplicate: expected,
                    case,
                    note: Some(format!("mined + verified ({})", case.label())),
                })
            }
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    // Dedupe (unordered) so the same pair proposed under two scenarios lands once.
    let mut seen = std::collections::HashSet::new();
    let mut pairs: Vec<LabeledPair> = Vec::new();
    for pair in verified.into_iter().flatten() {
        let key = if pair.a < pair.b {
            (pair.a.clone(), pair.b.clone())
        } else {
            (pair.b.clone(), pair.a.clone())
        };
        if seen.insert(key) {
            pairs.push(pair);
        }
    }
    println!("[mine] kept {} verified pairs", pairs.len());

    write_corpus(
        &out,
        EvalCorpus {
            tasks: Vec::new(),
            pairs,
        },
    )
}

async fn propose_mined(
    recorder: &dyn ai_usage::UsageRecorder,
    scenario: &Scenario,
    count: usize,
    catalog: &str,
) -> Result<Vec<(String, String)>> {
    let system = format!(
        "You find pairs of EXISTING tasks that fit a scenario, from a catalog of real tasks \
         (one per line: `id<TAB>title | body`). Only propose pairs you are confident about. \
         Reference tasks by their exact id. Never invent ids.\n\nScenario:\n{}",
        scenario.definition
    );
    let schema = DynamicSchema {
        name: "MinedPairs".to_string(),
        description: Some("Ids of existing task pairs fitting the scenario.".to_string()),
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["pairs"],
            "properties": {
                "pairs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["a_id", "b_id"],
                        "properties": {
                            "a_id": {"type": "string"},
                            "b_id": {"type": "string"}
                        }
                    }
                }
            }
        }),
    };
    let value = dynamic_structured_completion(
        ORACLE,
        &system,
        vec![Message::user(format!(
            "Catalog:\n{catalog}\n\nPropose up to {count} high-confidence pairs for this scenario."
        ))],
        schema,
        recorder,
        ai_usage::UsageContext::system(ai_usage::AiFeature::Automation),
    )
    .await?;

    Ok(value
        .get("pairs")
        .and_then(serde_json::Value::as_array)
        .map(|pairs| {
            pairs
                .iter()
                .filter_map(|pair| {
                    Some((
                        pair.get("a_id")?.as_str()?.to_string(),
                        pair.get("b_id")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default())
}

fn write_corpus(path: &PathBuf, corpus: EvalCorpus) -> Result<()> {
    let json = corpus.to_json()?;
    std::fs::write(path, json).with_context(|| format!("write {}", path.display()))?;
    println!(
        "wrote {} task(s), {} pair(s) to {}",
        corpus.tasks.len(),
        corpus.pairs.len(),
        path.display()
    );
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let recorder = Arc::new(NoopRecorder);
    match args.command {
        Command::Generate { per_scenario, out } => {
            run_generate(recorder, args.concurrency, per_scenario, out).await
        }
        Command::Mine {
            prod,
            per_scenario,
            out,
        } => run_mine(recorder, args.concurrency, prod, per_scenario, out).await,
    }
}
