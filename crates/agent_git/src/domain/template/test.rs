use std::collections::BTreeMap;
use std::path::Path;

use super::{PersonaSeed, WORKSPACE_TEMPLATE};

#[test]
fn every_canonical_file_is_seeded_with_its_contents() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/brain/template");
    let mut pending = vec![root.clone()];
    let mut expected = BTreeMap::new();
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
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

    let rendered = WORKSPACE_TEMPLATE
        .render(&PersonaSeed {
            name: "Example".into(),
            job_description: "Help with operations".into(),
            personality: "Thoughtful".into(),
            creator_id: None,
        })
        .unwrap();
    assert_eq!(rendered.len(), expected.len());
    for file in rendered {
        if file.path != "OPERATING.md" && file.path != "config/jev.json" {
            assert_eq!(
                Some(&file.contents),
                expected.get(file.path),
                "{}",
                file.path
            );
        }
    }
}
