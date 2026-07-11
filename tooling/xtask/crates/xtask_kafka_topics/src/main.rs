//! `cargo x kafka-topics [--check]`
//!
//! Generates `.github/kafka-cluster-topics.json`: the name of every Kafka
//! topic declared in the `macro_event_topics` crate, consumed by infra
//! (alongside `services-config.json`) to ensure all cluster topics are
//! created. The `--check` variant fails on drift instead of writing, so CI
//! can guarantee the checked-in file always matches the crate.

use std::collections::BTreeSet;

use anyhow::{Context, Result, bail};

const OUTPUT_REL: &str = ".github/kafka-cluster-topics.json";

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [] => run(false),
        ["--check"] => run(true),
        _ => bail!("usage: cargo x kafka-topics [--check]"),
    }
}

/// Regenerates (or, in check mode, diffs) the topics file.
fn run(check: bool) -> Result<()> {
    let output_path = xtask_paths::repo_root().join(OUTPUT_REL);

    // Sorted for a deterministic file regardless of declaration order. A bare
    // array (no disclaimer wrapper) so infra can parse the file directly.
    let topics: BTreeSet<&'static str> =
        macro_event_topics::all_topic_names().into_iter().collect();

    let new_contents =
        serde_json::to_string_pretty(&topics).context("serializing kafka topics")? + "\n";

    let current = std::fs::read_to_string(&output_path).unwrap_or_default();
    if current != new_contents {
        if check {
            bail!(
                "{OUTPUT_REL} is stale\nrun `cargo x kafka-topics` from the repository root and commit the result"
            );
        }
        std::fs::write(&output_path, &new_contents)
            .with_context(|| format!("writing {}", output_path.display()))?;
        println!("updated {OUTPUT_REL} ({} topics)", topics.len());
    } else if check {
        println!("{OUTPUT_REL} is up to date");
    }
    Ok(())
}
