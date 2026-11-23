use std::collections::BTreeMap;
use std::path::Path;

use super::WORKSPACE_TEMPLATE;

/// Every file git tracks in `packages/starter-agent`, minus the workspace's
/// Biome config, is embedded with its contents.
#[test]
fn every_starter_file_is_embedded_with_its_contents() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/starter-agent");
    let mut pending = vec![root.clone()];
    let mut expected = BTreeMap::new();
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            if matches!(name.as_str(), "node_modules" | "biome.jsonc" | ".worktrees")
                || name.starts_with(".scripts")
            {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let relative = path.strip_prefix(&root).unwrap().to_str().unwrap();
                expected.insert(
                    relative.replace('\\', "/"),
                    std::fs::read_to_string(&path).unwrap(),
                );
            }
        }
    }
    let embedded: BTreeMap<_, _> = WORKSPACE_TEMPLATE
        .files
        .iter()
        .map(|file| (file.path.to_owned(), file.contents.to_owned()))
        .collect();
    assert_eq!(
        WORKSPACE_TEMPLATE.files.len(),
        expected.len(),
        "no duplicate paths"
    );
    assert_eq!(embedded, expected);
}

/// What the agent's process reads before it starts is in the template.
#[test]
fn the_runtime_entry_points_are_embedded() {
    for path in [
        "AGENT.md",
        "CLAUDE.md",
        "cli.ts",
        "index.ts",
        "package.json",
        "bun.lock",
        "tsconfig.json",
        ".gitignore",
        "behavior/index.ts",
    ] {
        assert!(
            WORKSPACE_TEMPLATE
                .files
                .iter()
                .any(|file| file.path == path),
            "{path}"
        );
    }
    assert!(
        !WORKSPACE_TEMPLATE
            .files
            .iter()
            .any(|file| file.path.contains("node_modules") || file.path == "biome.jsonc")
    );
}
