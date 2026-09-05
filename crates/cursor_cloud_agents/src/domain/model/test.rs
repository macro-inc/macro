use super::*;

#[test]
fn repo_urls_normalize_every_remote_form() {
    for remote in [
        "git@github.com:macro-inc/macro.git",
        "git@github.com:macro-inc/macro",
        "ssh://git@github.com/macro-inc/macro.git",
        "https://github.com/macro-inc/macro.git",
        "https://github.com/macro-inc/macro",
        "  https://github.com/macro-inc/macro\n",
    ] {
        let parsed = RepoUrl::parse(remote).unwrap_or_else(|| panic!("{remote:?} should parse"));
        assert_eq!(parsed.as_str(), "https://github.com/macro-inc/macro");
    }
}

#[test]
fn non_https_remotes_are_rejected_not_guessed() {
    assert_eq!(RepoUrl::parse("/local/path/repo"), None);
    assert_eq!(RepoUrl::parse("ftp://example.com/repo"), None);
    assert_eq!(RepoUrl::parse(""), None);
}

fn model(id: &str, display_name: &str) -> CursorModel {
    CursorModel {
        id: id.to_owned(),
        display_name: display_name.to_owned(),
        variants: Vec::new(),
    }
}

#[test]
fn families_are_the_words_before_the_version() {
    for (display_name, family) in [
        ("Claude Opus 4.8", "Claude Opus"),
        ("Claude Opus 5", "Claude Opus"),
        ("Claude Sonnet 4.5", "Claude Sonnet"),
        ("Cursor Grok 4.6 High Fast", "Cursor Grok"),
        ("GPT-5.6 Sol", "GPT"),
        ("GPT-5 Mini", "GPT"),
        ("Gemini 3.8 Flash", "Gemini"),
        ("Kimi K3", "Kimi"),
        ("GLM 5.2", "GLM"),
        ("Composer 2.5", "Composer"),
        ("DeepSeek R1", "DeepSeek"),
    ] {
        assert_eq!(
            model("m", display_name).family(),
            family,
            "{display_name:?} should be in {family:?}"
        );
    }
}

#[test]
fn names_without_a_leading_family_stay_whole() {
    for display_name in ["Auto", "o3 Pro", "4o Mini", "gpt-oss", "  Auto  "] {
        assert_eq!(
            model("m", display_name).family(),
            display_name.trim(),
            "{display_name:?} has no family to strip"
        );
    }
}

#[test]
fn grouping_keeps_listing_order_within_and_across_families() {
    let models = vec![
        model("default", "Auto"),
        model("opus-5", "Claude Opus 5"),
        model("gpt-5.6", "GPT-5.6 Sol"),
        model("opus-4.8", "Claude Opus 4.8"),
        model("gpt-5-mini", "GPT-5 Mini"),
    ];

    let families = ModelFamily::group(&models);

    let summary: Vec<(&str, &str, Vec<&str>)> = families
        .iter()
        .map(|family| {
            (
                family.id.as_str(),
                family.name.as_str(),
                family
                    .models
                    .iter()
                    .map(|model| model.id.as_str())
                    .collect(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            ("auto", "Auto", vec!["default"]),
            ("claude-opus", "Claude Opus", vec!["opus-5", "opus-4.8"]),
            ("gpt", "GPT", vec!["gpt-5.6", "gpt-5-mini"]),
        ]
    );
    assert!(ModelFamily::is_informative(&families));
}

#[test]
fn a_listing_of_singletons_is_not_worth_grouping() {
    let families = ModelFamily::group(&[
        model("composer-2.5", "Composer 2.5"),
        model("gpt-5.5", "GPT-5.5"),
    ]);

    assert_eq!(families.len(), 2);
    assert!(!ModelFamily::is_informative(&families));
}

#[test]
fn family_ids_are_url_safe() {
    assert_eq!(family_id("Claude Opus"), "claude-opus");
    assert_eq!(family_id("GPT"), "gpt");
    assert_eq!(family_id("  Odd / Name!  "), "odd-name");
}

#[test]
fn run_statuses_round_trip_unknown_values() {
    let known: RunStatus = serde_json::from_str("\"FINISHED\"").expect("known status");
    assert_eq!(known, RunStatus::Finished);
    let unknown: RunStatus = serde_json::from_str("\"PAUSED\"").expect("unknown status");
    assert_eq!(unknown, RunStatus::Unknown("PAUSED".to_owned()));
}
