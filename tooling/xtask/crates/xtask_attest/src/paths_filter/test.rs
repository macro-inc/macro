use super::*;

fn decided(filters: &str, changed: &[&str]) -> BTreeMap<String, String> {
    let changed: Vec<String> = changed.iter().map(|path| (*path).to_owned()).collect();
    outputs(filters, &changed).expect("filters evaluate")
}

const FILTERS: &str = "
should_run:
  - 'Cargo.toml'
  - '.cargo/**'
  - 'crates/**'
  - 'nix-support/node_modules*'
  - .github/workflows/code_check_cloud_storage.yml
doppler_candidates:
  - '**/src/config.rs'
  - '**/Cargo.toml'
query_data:
  - '**/.sqlx/**'
";

#[test]
fn a_directory_pattern_matches_files_at_any_depth() {
    let outputs = decided(FILTERS, &["crates/email/src/domain/service.rs"]);

    assert_eq!(outputs["should_run"], "true");
    assert_eq!(outputs["doppler_candidates"], "false");
    assert_eq!(outputs["query_data"], "false");
}

#[test]
fn a_plain_name_matches_only_at_the_root() {
    let outputs = decided(FILTERS, &["services/email_service/Cargo.toml"]);

    assert_eq!(outputs["should_run"], "false");
    assert_eq!(outputs["doppler_candidates"], "true");
}

#[test]
fn a_leading_double_star_also_matches_the_root() {
    let outputs = decided(FILTERS, &["Cargo.toml", ".sqlx/query-1.json"]);

    assert_eq!(outputs["doppler_candidates"], "true");
    assert_eq!(outputs["query_data"], "true");
}

#[test]
fn a_star_stays_inside_one_segment_and_matches_dot_files() {
    assert_eq!(
        decided(FILTERS, &["nix-support/node_modules-hashes.json"])["should_run"],
        "true"
    );
    assert_eq!(
        decided(FILTERS, &["nix-support/node_modules/x.json"])["should_run"],
        "false"
    );
    assert_eq!(
        decided(FILTERS, &[".cargo/config.toml"])["should_run"],
        "true"
    );
}

#[test]
fn nothing_changed_matches_nothing() {
    assert!(decided(FILTERS, &[]).values().all(|value| value == "false"));
}

#[test]
fn refuses_filters_it_does_not_emulate() {
    assert!(outputs("docs:\n  - '!docs/**'\n", &[]).is_err());
    assert!(outputs("docs:\n  - added|modified: 'docs/**'\n", &[]).is_err());
}
