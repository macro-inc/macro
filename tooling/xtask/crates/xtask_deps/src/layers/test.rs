use super::*;

#[test]
fn edge_into_a_layer_not_in_may_depend_on_is_a_violation() {
    let config: LayerConfig = toml::from_str(
        r#"
        [[layer]]
        name = "types"
        paths = ["crates/types/**"]
        may_depend_on = ["types"]

        [[layer]]
        name = "domain"
        paths = ["crates/email/*"]
        may_depend_on = ["types", "domain"]
        "#,
    )
    .unwrap();
    let crates = vec![
        Crate {
            name: "bot_id".to_owned(),
            path: "crates/types/bot_id".to_owned(),
        },
        Crate {
            name: "email".to_owned(),
            path: "crates/email/email".to_owned(),
        },
    ];
    let edges = vec![
        Edge {
            from: "email".to_owned(),
            to: "bot_id".to_owned(),
            kind: EdgeKind::Normal,
        },
        Edge {
            from: "bot_id".to_owned(),
            to: "email".to_owned(),
            kind: EdgeKind::Normal,
        },
    ];

    let report = check(&config, &crates, &edges).unwrap();

    assert_eq!(
        report,
        Report {
            violations: vec![Violation {
                from: "bot_id".to_owned(),
                from_layer: "types".to_owned(),
                to: "email".to_owned(),
                to_layer: "domain".to_owned(),
                kind: EdgeKind::Normal,
            }],
            ..Report::default()
        }
    );
}

#[test]
fn single_star_does_not_match_nested_directories_and_literal_paths_match_exactly() {
    let config: LayerConfig = toml::from_str(
        r#"
        [[layer]]
        name = "types"
        paths = ["crates/types/*", "crates/bot_id"]
        may_depend_on = ["types"]
        "#,
    )
    .unwrap();
    let crates = vec![
        Crate {
            name: "harness_id".to_owned(),
            path: "crates/types/harness_id".to_owned(),
        },
        Crate {
            name: "bot_id".to_owned(),
            path: "crates/bot_id".to_owned(),
        },
        Crate {
            name: "nested".to_owned(),
            path: "crates/types/group/nested".to_owned(),
        },
        Crate {
            name: "bot_id_extra".to_owned(),
            path: "crates/bot_id_extra".to_owned(),
        },
    ];

    let report = check(&config, &crates, &[]).unwrap();

    assert_eq!(
        report,
        Report {
            unassigned: vec!["bot_id_extra".to_owned(), "nested".to_owned()],
            ..Report::default()
        }
    );
}

#[test]
fn allow_entry_moves_a_violation_to_allowed_and_an_unused_one_is_stale() {
    let config: LayerConfig = toml::from_str(
        r#"
        [[layer]]
        name = "types"
        paths = ["crates/model"]
        may_depend_on = ["types"]

        [[layer]]
        name = "domain"
        paths = ["crates/agent"]
        may_depend_on = ["types", "domain"]

        [[allow]]
        from = "model"
        to = "agent"
        reason = "chat message types; N1 moves them out"

        [[allow]]
        from = "model"
        to = "email"
        reason = "removed since"
        "#,
    )
    .unwrap();
    let crates = vec![
        Crate {
            name: "model".to_owned(),
            path: "crates/model".to_owned(),
        },
        Crate {
            name: "agent".to_owned(),
            path: "crates/agent".to_owned(),
        },
    ];
    let edges = vec![Edge {
        from: "model".to_owned(),
        to: "agent".to_owned(),
        kind: EdgeKind::Normal,
    }];

    let report = check(&config, &crates, &edges).unwrap();

    assert_eq!(
        report,
        Report {
            allowed: vec![Violation {
                from: "model".to_owned(),
                from_layer: "types".to_owned(),
                to: "agent".to_owned(),
                to_layer: "domain".to_owned(),
                kind: EdgeKind::Normal,
            }],
            stale_allows: vec![Allow {
                from: "model".to_owned(),
                to: "email".to_owned(),
                reason: "removed since".to_owned(),
            }],
            ..Report::default()
        }
    );
}

#[test]
fn dev_edges_are_exempt_except_that_only_dev_edges_may_reach_a_dev_only_layer() {
    let config: LayerConfig = toml::from_str(
        r#"
        [[layer]]
        name = "types"
        paths = ["crates/bot_id"]
        may_depend_on = ["types"]

        [[layer]]
        name = "domain"
        paths = ["crates/email"]
        may_depend_on = ["types", "domain", "testing"]

        [[layer]]
        name = "testing"
        paths = ["crates/local_e2e_test_support"]
        may_depend_on = ["types", "domain", "testing"]
        dev_only = true
        "#,
    )
    .unwrap();
    let crates = vec![
        Crate {
            name: "bot_id".to_owned(),
            path: "crates/bot_id".to_owned(),
        },
        Crate {
            name: "email".to_owned(),
            path: "crates/email".to_owned(),
        },
        Crate {
            name: "local_e2e_test_support".to_owned(),
            path: "crates/local_e2e_test_support".to_owned(),
        },
    ];
    let edges = vec![
        Edge {
            from: "bot_id".to_owned(),
            to: "email".to_owned(),
            kind: EdgeKind::DevOnly,
        },
        Edge {
            from: "bot_id".to_owned(),
            to: "local_e2e_test_support".to_owned(),
            kind: EdgeKind::DevOnly,
        },
        Edge {
            from: "email".to_owned(),
            to: "local_e2e_test_support".to_owned(),
            kind: EdgeKind::Normal,
        },
    ];

    let report = check(&config, &crates, &edges).unwrap();

    assert_eq!(
        report,
        Report {
            violations: vec![Violation {
                from: "email".to_owned(),
                from_layer: "domain".to_owned(),
                to: "local_e2e_test_support".to_owned(),
                to_layer: "testing".to_owned(),
                kind: EdgeKind::Normal,
            }],
            ..Report::default()
        }
    );
}

#[test]
fn may_depend_on_packages_allows_one_crate_of_another_layer() {
    let config: LayerConfig = toml::from_str(
        r#"
        [[layer]]
        name = "client"
        paths = ["crates/client/*"]
        may_depend_on = ["client"]
        may_depend_on_packages = ["agent_fold"]

        [[layer]]
        name = "domain"
        paths = ["crates/folds/*"]
        may_depend_on = ["client", "domain"]
        "#,
    )
    .unwrap();
    let crates = vec![
        Crate {
            name: "cache-core".to_owned(),
            path: "crates/client/cache-core".to_owned(),
        },
        Crate {
            name: "agent_fold".to_owned(),
            path: "crates/folds/agent_fold".to_owned(),
        },
        Crate {
            name: "codex_fold".to_owned(),
            path: "crates/folds/codex_fold".to_owned(),
        },
    ];
    let edges = vec![
        Edge {
            from: "cache-core".to_owned(),
            to: "agent_fold".to_owned(),
            kind: EdgeKind::Normal,
        },
        Edge {
            from: "cache-core".to_owned(),
            to: "codex_fold".to_owned(),
            kind: EdgeKind::Normal,
        },
    ];

    let report = check(&config, &crates, &edges).unwrap();

    assert_eq!(
        report.violations,
        vec![Violation {
            from: "cache-core".to_owned(),
            from_layer: "client".to_owned(),
            to: "codex_fold".to_owned(),
            to_layer: "domain".to_owned(),
            kind: EdgeKind::Normal,
        }]
    );
}

#[test]
fn ignored_crates_and_edges_touching_them_are_skipped_and_unmatched_literal_paths_reported() {
    let config: LayerConfig = toml::from_str(
        r#"
        ignore = ["crates/workspace-hack"]

        [[layer]]
        name = "types"
        paths = ["crates/bot_id", "crates/moved_away", "crates/types/**"]
        may_depend_on = ["types"]
        "#,
    )
    .unwrap();
    let crates = vec![
        Crate {
            name: "bot_id".to_owned(),
            path: "crates/bot_id".to_owned(),
        },
        Crate {
            name: "workspace-hack".to_owned(),
            path: "crates/workspace-hack".to_owned(),
        },
    ];
    let edges = vec![Edge {
        from: "bot_id".to_owned(),
        to: "workspace-hack".to_owned(),
        kind: EdgeKind::Normal,
    }];

    let report = check(&config, &crates, &edges).unwrap();

    assert_eq!(
        report,
        Report {
            unmatched_paths: vec!["crates/moved_away".to_owned()],
            ..Report::default()
        }
    );
}

#[test]
fn a_crate_matched_by_two_layers_is_a_config_error() {
    let config: LayerConfig = toml::from_str(
        r#"
        [[layer]]
        name = "types"
        paths = ["crates/*"]
        may_depend_on = ["types"]

        [[layer]]
        name = "domain"
        paths = ["crates/email"]
        may_depend_on = ["types", "domain"]
        "#,
    )
    .unwrap();
    let crates = vec![Crate {
        name: "email".to_owned(),
        path: "crates/email".to_owned(),
    }];

    let error = check(&config, &crates, &[]).unwrap_err();

    assert_eq!(
        error.to_string(),
        "crate `email` (crates/email) is in two layers: `types` and `domain`"
    );
}

#[test]
fn may_depend_on_naming_an_unknown_layer_is_a_config_error() {
    let config: LayerConfig = toml::from_str(
        r#"
        [[layer]]
        name = "types"
        paths = ["crates/types/**"]
        may_depend_on = ["typos"]
        "#,
    )
    .unwrap();

    let error = check(&config, &[], &[]).unwrap_err();

    assert_eq!(
        error.to_string(),
        "layer `types` may_depend_on names unknown layer `typos`"
    );
}

#[test]
fn only_allowed_violations_keep_the_report_clean() {
    let violation = Violation {
        from: "shared_types".to_owned(),
        from_layer: "types".to_owned(),
        to: "agent_loop".to_owned(),
        to_layer: "domain".to_owned(),
        kind: EdgeKind::Normal,
    };
    let baselined = Report {
        allowed: vec![violation.clone()],
        ..Report::default()
    };
    assert!(baselined.is_clean());

    let failing = [
        Report {
            violations: vec![violation],
            ..Report::default()
        },
        Report {
            stale_allows: vec![Allow {
                from: "shared_types".to_owned(),
                to: "email".to_owned(),
                reason: "removed since".to_owned(),
            }],
            ..Report::default()
        },
        Report {
            unassigned: vec!["new_crate".to_owned()],
            ..Report::default()
        },
        Report {
            unmatched_paths: vec!["crates/types/gone".to_owned()],
            ..Report::default()
        },
    ];
    for report in failing {
        assert!(!report.is_clean(), "{report:?}");
    }
}
