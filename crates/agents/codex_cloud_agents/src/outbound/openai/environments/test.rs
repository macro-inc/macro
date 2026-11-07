use super::*;
use serde_json::json;

fn repository(name: &str) -> serde_json::Value {
    json!({"repository_full_name":name,"clone_url":format!("https://github.com/{name}.git"),"default_branch":"trunk", "secret":"private-marker"})
}

#[test]
fn projects_ordered_repositories_and_omits_private_configuration() {
    let raw = json!({"id":"env-1","label":"Misleading label","repos":["two","one"],
        "repo_map":{"one":repository("owner/one"),"two":repository("owner/two")},
        "env_vars":{"KEY":"private-marker"},"setup":"private-marker","secrets":{"key":"private-marker"}});
    let environment = serde_json::from_value::<ProviderEnvironment>(raw)
        .unwrap()
        .project()
        .unwrap();
    assert_eq!(
        environment
            .repositories
            .iter()
            .map(|repo| repo.full_name.as_str())
            .collect::<Vec<_>>(),
        vec!["owner/two", "owner/one"]
    );
    assert_eq!(environment.repositories[0].default_branch, "trunk");
    let output = serde_json::to_string(&environment).unwrap();
    assert!(!output.contains("private-marker"));
    assert!(!output.contains("repo_map"));
}

#[test]
fn invalid_primary_never_promotes_secondary_and_url_identity_is_verified() {
    for url in [
        "https://token@github.com/owner/one.git",
        "https://github.com/owner/one.git?token=secret",
        "https://github.com/owner/one.git#secret",
        "https://github.com/other/one.git",
        "http://github.com/owner/one.git",
    ] {
        let mut first = repository("owner/one");
        first["clone_url"] = url.into();
        let raw = json!({"id":"env-1","label":"owner/two","repos":["one","two"],"repo_map":{"one":first,"two":repository("owner/two")}});
        assert!(
            serde_json::from_value::<ProviderEnvironment>(raw)
                .unwrap()
                .project()
                .unwrap()
                .repositories
                .is_empty()
        );
    }
    let raw =
        json!({"id":"env-1","repos":["missing","two"],"repo_map":{"two":repository("owner/two")}});
    assert!(
        serde_json::from_value::<ProviderEnvironment>(raw)
            .unwrap()
            .project()
            .unwrap()
            .repositories
            .is_empty()
    );
}
