//! Generates `.github/kafka-cluster-topics.json`: the name of every Kafka
//! topic declared in the `macro_event_topics` crate, consumed by infra
//! (alongside `services-config.json`) to ensure all cluster topics are
//! created. The `--check` variant fails on drift instead of writing, so CI
//! can guarantee the checked-in file always matches the crate.

use std::collections::BTreeSet;
use std::path::Path;

use anyhow::{bail, Context, Result};

const OUTPUT_REL: &str = ".github/kafka-cluster-topics.json";

/// Regenerates (or, in check mode, diffs) the topics file.
pub fn run(check: bool) -> Result<()> {
    // Anchor on the manifest dir, not the invocation cwd, so the task works
    // from anywhere in the repo. The crate lives at
    // `<repo-root>/rust/cloud-storage/tools/xtask`, i.e. four ancestors up.
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .context("xtask manifest dir has no repo root four levels up")?;
    let output_path = repo_root.join(OUTPUT_REL);

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
                "{OUTPUT_REL} is stale\nrun `cargo x kafka-topics` from rust/cloud-storage and commit the result"
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
