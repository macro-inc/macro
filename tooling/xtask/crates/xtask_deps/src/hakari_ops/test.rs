use super::non_inherited;
use std::collections::BTreeSet;

#[test]
fn reports_final_excluded_crates_not_taken_from_the_workspace() {
    let manifest: toml::Table = toml::from_str(
        r#"
[dependencies]
redis = { workspace = true, features = ["streams"] }
rmcp = "1.6.0"
serde = "1"

[dev-dependencies]
rig-core = { version = "0.41.0", features = ["test-utils"] }

[target.'cfg(unix)'.build-dependencies]
graphql = { package = "async-graphql", version = "7" }
"#,
    )
    .expect("valid manifest");
    let names = BTreeSet::from(["redis", "rmcp", "rig-core", "async-graphql"]);

    let mut found = non_inherited(&manifest, &names);
    found.sort_unstable();

    assert_eq!(found, vec!["async-graphql", "rig-core", "rmcp"]);
}

#[test]
fn accepts_a_manifest_that_inherits_every_final_excluded_crate() {
    let manifest: toml::Table = toml::from_str(
        r#"
[dependencies]
redis = { workspace = true }
rig-core = { workspace = true }

[dev-dependencies]
rig-core = { workspace = true, features = ["test-utils"] }
"#,
    )
    .expect("valid manifest");
    let names = BTreeSet::from(["redis", "rig-core"]);

    assert!(non_inherited(&manifest, &names).is_empty());
}
