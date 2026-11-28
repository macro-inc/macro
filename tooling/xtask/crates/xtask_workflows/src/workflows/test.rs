use serde_yaml::Value;

use super::{WORKFLOWS, runners::DB_MIGRATOR};

#[test]
fn migrator_jobs_do_not_invoke_build_tools() {
    let mut violations = Vec::new();

    for workflow in WORKFLOWS {
        let yaml = (workflow.render_yaml)().expect("workflow renders");
        let root: Value = serde_yaml::from_str(&yaml).expect("workflow parses");

        for (id, job) in root["jobs"].as_mapping().expect("jobs") {
            let runs_on = &job["runs-on"];
            let labels = if runs_on.is_mapping() {
                &runs_on["labels"]
            } else {
                runs_on
            };
            if labels.as_str() != Some(DB_MIGRATOR)
                && !labels.as_sequence().is_some_and(|labels| {
                    labels
                        .iter()
                        .any(|label| label.as_str() == Some(DB_MIGRATOR))
                })
            {
                continue;
            }

            for step in job["steps"].as_sequence().into_iter().flatten() {
                let Some(script) = step["run"].as_str() else {
                    continue;
                };

                // Check literal tool names even inside compound commands or
                // command substitutions. Ignore full-line comments and names
                // such as NIX_CACHE_URL and runtime-nix-cache.
                for line in script
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.starts_with('#'))
                {
                    let mut words = line.split(|ch: char| {
                        !(ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
                    });
                    if words.any(|word| matches!(word, "cargo" | "rustup" | "nix")) {
                        violations.push(format!(
                            "{} / {} / {}: {line}",
                            workflow.file_name,
                            id.as_str().expect("job id"),
                            step["name"].as_str().unwrap_or("<unnamed step>"),
                        ));
                    }
                }
            }
        }
    }

    assert!(
        violations.is_empty(),
        "{DB_MIGRATOR} run steps must use prebuilt tools:\n{}",
        violations.join("\n")
    );
}
