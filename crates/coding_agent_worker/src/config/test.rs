use super::*;

const EXAMPLE: &str = include_str!("../../config.example.toml");

#[test]
fn the_example_config_parses() {
    let config: Config = toml::from_str(EXAMPLE).expect("example config parses");
    assert_eq!(config.harness.command, "opencode");
    assert_eq!(config.harness.args, vec!["acp"]);
}

#[test]
fn unknown_fields_are_rejected() {
    let with_typo = EXAMPLE.replace("repo_url", "repo_uri");
    assert!(toml::from_str::<Config>(&with_typo).is_err());
}

#[test]
fn args_default_to_empty() {
    let without_args = EXAMPLE.replace("args = [\"acp\"]\n", "");
    let config: Config = toml::from_str(&without_args).expect("args are optional");
    assert!(config.harness.args.is_empty());
}
