use super::*;
const ORACLE: &str = include_str!(
    "../../../../../../packages/lexical-conformance/fixtures/upstream/lexical/ffc8c725882fc6f3.json"
);

#[test]
fn line_break_constructor_replays_every_call_commit_and_final_snapshot() -> Result<()> {
    let fixture: Fixture = serde_json::from_str(ORACLE)?;
    assert_eq!(
        fixture.source.test,
        vec!["LexicalLineBreakNode tests", "LineBreakNode.constructor"]
    );
    Replayer::default().replay(&fixture)
}
#[test]
fn wrong_snapshot_text_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.r#final["text"] = json!("wrong");
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must compare final text")
            .to_string()
            .contains("snapshot text")
    );
    Ok(())
}
#[test]
fn unknown_snapshot_observable_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.r#final["extraObservable"] = json!(1);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must reject extra fields")
            .to_string()
            .contains("unsupported snapshot observable")
    );
    Ok(())
}
#[test]
fn unknown_entropy_source_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.trace[1]["src"] = json!("unknown");
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must validate host input")
            .to_string()
            .contains("unsupported entropy")
    );
    Ok(())
}
#[test]
fn foreign_upstream_version_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.source.version = "9.0.0".into();
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must pin oracle")
            .to_string()
            .contains("unsupported upstream")
    );
    Ok(())
}
#[test]
fn configured_replacement_fails_before_replay() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.config["replacements"] = json!([{"replace":"text","with":"test_text"}]);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must not ignore config")
            .to_string()
            .contains("configured replacement/plugin")
    );
    Ok(())
}
#[test]
fn wrong_node_version_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.trace[4]["calls"][0]["ret"]["ver"] = json!(99);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must compare versions")
            .to_string()
            .contains("node version")
    );
    Ok(())
}
#[test]
fn wrong_node_type_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.trace[4]["calls"][0]["ret"]["type"] = json!("paragraph");
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must compare types")
            .to_string()
            .contains("node type")
    );
    Ok(())
}
#[test]
fn unconsumed_callback_invocation_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.tapes.push(crate::fixture::Tape {
        invocations: vec![crate::fixture::Invocation {
            args: vec![json!(1)],
            calls: vec![],
            ret: Some(json!(true)),
            throws: None,
        }],
    });
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must exhaust tapes")
            .to_string()
            .contains("missing callback")
    );
    Ok(())
}

#[test]
fn update_for_a_different_editor_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.trace[4]["editor"] = json!(999);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must validate editor")
            .to_string()
            .contains("editor id")
    );
    Ok(())
}
#[test]
fn nested_update_parent_fails_until_supported() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.trace[4]["parent"] = json!(99);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must validate nesting")
            .to_string()
            .contains("nested update parent")
    );
    Ok(())
}
#[test]
fn discrete_update_cannot_wait_for_a_later_tick() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.trace[4]["opts"]["discrete"] = json!(true);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must enforce discrete boundary")
            .to_string()
            .contains("immediate commit")
    );
    Ok(())
}
#[test]
fn undeclared_production_outcome_policy_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.outcome_differs.push(json!({"dev":"x","prod":"y"}));
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must validate outcomes")
            .to_string()
            .contains("outcome policy")
    );
    Ok(())
}

#[test]
fn omitted_custom_class_is_not_registered_by_the_interpreter() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.config["nodes"] = json!([]);
    fixture.trace[2]["config"]["nodes"] = json!([]);
    fixture.trace[4]["calls"]
        .as_array_mut()
        .expect("calls")
        .truncate(1);
    fixture.trace[4]["calls"][0]["fn"] = json!("lexical/__tests__/utils.$createTestElementNode");
    fixture.trace[4]["calls"][0]["ret"]["type"] = json!("test_block");
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}
#[test]
fn detached_root_does_not_generate_an_attached_root_commit() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.config["rootElement"] = json!(false);
    fixture.trace[2]["config"]["rootElement"] = json!(false);
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}

#[test]
fn wrong_selection_kind_fails_before_it_can_be_installed() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.trace[4]["calls"] = json!([{
        "op":"call","fn":"lexical.$createRangeSelection","args":[],
        "ret":{"$sel":1,"kind":"node"}
    }]);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must compare selection kind")
            .to_string()
            .contains("selection kind mismatch")
    );
    Ok(())
}
#[test]
fn an_extra_commit_without_a_pending_update_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.trace.push(fixture.trace[7].clone());
    let op = fixture.trace.last_mut().expect("extra commit");
    op["index"] = json!(3);
    op["updates"] = json!([]);
    op["causes"] = json!([]);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("must not invent commits")
            .to_string()
            .contains("commit without a pending update")
    );
    Ok(())
}

#[test]
fn caret_metadata_and_object_identity_are_observable() {
    use serde_json::json;
    let mut replay = Replayer::default();
    let actual = json!({"$caretValue":0,"type":"child","direction":"next"});
    assert!(
        replay
            .compare(
                &json!({"$caret":1,"type":"child","direction":"previous"}),
                &actual
            )
            .is_err()
    );
    assert!(
        replay
            .compare(
                &json!({"$caret":1,"type":"text","direction":"next"}),
                &actual
            )
            .is_err()
    );
    replay
        .compare(
            &json!({"$caret":1,"type":"child","direction":"next"}),
            &actual,
        )
        .unwrap();
    assert!(
        replay
            .compare(
                &json!({"$caret":2,"type":"child","direction":"next"}),
                &actual
            )
            .is_err()
    );
    assert!(
        replay
            .compare(&json!({"$caret":1}), &json!({"$caretValue":3}))
            .is_err()
    );
}

#[test]
fn rich_command_registration_is_required_and_snapshots_stay_strict() -> Result<()> {
    let fixture: Fixture = serde_json::from_str(include_str!(
        "../../../../../../packages/lexical-conformance/fixtures/upstream/lexical-rich-text/18ab5b575b3c7062.json"
    ))?;
    Replayer::default().replay(&fixture)?;
    let mut missing = fixture.clone();
    missing.trace.retain(|op| op["op"] != "plugin");
    assert!(
        Replayer::default()
            .replay(&missing)
            .expect_err("missing listener cannot claim command")
            .to_string()
            .contains("value mismatch: true != false")
    );
    let mut wrong = fixture;
    wrong.r#final["json"]["root"]["children"][0]["children"][0]["format"] = json!(0);
    assert!(
        Replayer::default()
            .replay(&wrong)
            .expect_err("must compare node formatting")
            .to_string()
            .contains("snapshot JSON")
    );
    Ok(())
}
#[test]
fn markdown_normalization_replays_real_calls_and_rejects_wrong_returns() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(include_str!(
        "../../../../../../packages/lexical-conformance/fixtures/upstream/lexical-markdown/048a1a6629fd63fa.json"
    ))?;
    Replayer::default().replay(&fixture)?;
    fixture.trace[0]["ret"] = json!("wrong");
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}

#[test]
fn generated_namespace_consumes_both_host_draws() -> Result<()> {
    let fixture: Fixture = serde_json::from_str(include_str!(
        "../../../../../../packages/lexical-conformance/fixtures/upstream/lexical-headless/5f8fd33bbfe13d33.json"
    ))?;
    Replayer::default().replay(&fixture)?;
    let mut missing_draw = fixture;
    missing_draw.trace.remove(0);
    assert!(Replayer::default().replay(&missing_draw).is_err());
    Ok(())
}

#[test]
fn macro_markdown_uses_two_space_nested_list_indentation() -> Result<()> {
    let mut r = Replayer {
        in_callback: true,
        markdown_options: lexical_markdown::MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut editor = test_nodes::configured_builder(&["list".into(), "listitem".into()], false)
        .build()
        .expect("registered lists");
    let mut tx = editor.transaction();
    crate::api::markdown::call(
        &mut r,
        &mut tx,
        "$convertFromMarkdownString",
        &[json!("- a\n  - b")],
    )?;
    let markdown = crate::api::markdown::call(&mut r, &mut tx, "$convertToMarkdownString", &[])?;
    assert_eq!(markdown, json!("- a\n  - b"));
    Ok(())
}

#[test]
fn partial_seed_with_nonsequential_keys_replays_and_corruption_fails() -> Result<()> {
    let fixture: Fixture = serde_json::from_str(include_str!(
        "../../../../../../packages/lexical-conformance/fixtures/upstream/lexical-markdown/5ede34e8f1b0f972.json"
    ))?;
    Replayer::default().replay(&fixture)?;
    let mut wrong = fixture;
    wrong.initial["selection"]["anchor"]["offset"] = json!(99999);
    assert!(Replayer::default().replay(&wrong).is_err());
    Ok(())
}

#[test]
fn declared_highlight_projection_keeps_allocation_dirty_normalized_and_text_checks() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    fixture.normalize = vec!["codeHighlight".into()];
    Replayer::default().replay(&fixture)?;
    let mut wrong = fixture.clone();
    wrong.r#final["text"] = json!("wrong");
    assert!(Replayer::default().replay(&wrong).is_err());
    let mut wrong = fixture.clone();
    wrong.r#final["nodeMapKeys"] = json!([]);
    assert!(Replayer::default().replay(&wrong).is_err());
    let mut wrong = fixture.clone();
    let commit = wrong
        .trace
        .iter_mut()
        .find(|op| op["op"] == "commit")
        .expect("commit");
    commit["snapshot"]["dirty"]["leaves"] = json!(["root"]);
    assert!(Replayer::default().replay(&wrong).is_err());
    let mut wrong = fixture;
    let commit = wrong
        .trace
        .iter_mut()
        .find(|op| op["op"] == "commit")
        .expect("commit");
    commit["snapshot"]["normalized"] = json!(["root"]);
    assert!(Replayer::default().replay(&wrong).is_err());
    Ok(())
}

#[test]
fn provenance_metadata_is_validated_literally() -> Result<()> {
    let fixture: Fixture = serde_json::from_str(ORACLE)?;
    crate::config::validate_config(&fixture.config)?;
    let mut alias = fixture.config.clone();
    alias["nodeClasses"]["heading"] =
        json!({"$fn":"@lexical/markdown/MarkdownTransformers.TRANSFORMERS.0.dependencies.0"});
    crate::config::validate_config(&alias)?;
    alias["nodeClasses"]["heading"] =
        json!({"$fn":"@lexical/markdown/MarkdownTransformers.TRANSFORMERS.1.dependencies.0"});
    assert!(crate::config::validate_config(&alias).is_err());
    let mut config = fixture.config.clone();
    config["namespaceGenerated"] = json!("true");
    assert!(crate::config::validate_config(&config).is_err());
    let mut config = fixture.config.clone();
    config["nodeClasses"]["paragraph"] = json!({"$fn":"@other.ParagraphNode"});
    assert!(crate::config::validate_config(&config).is_err());
    let mut config = fixture.config.clone();
    config["nodeClasses"]["paragraph"] = json!({"$fn":"lexical.TextNode"});
    assert!(crate::config::validate_config(&config).is_err());
    let mut config = fixture.config.clone();
    config["nodeClasses"]["paragraph"] = json!({"$fn":"lexical.ParagraphNode","extra":true});
    assert!(crate::config::validate_config(&config).is_err());
    let mut config = fixture.config;
    config["headless"] = json!(true);
    config["rootElement"] = json!(true);
    assert!(crate::config::validate_config(&config).is_err());
    Ok(())
}

#[test]
fn changing_only_recorded_slice_distance_fails() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(include_str!(
        "../../../../../../packages/lexical-conformance/fixtures/upstream/lexical/41395bd854ee320c.json"
    ))?;
    Replayer::default().replay(&fixture)?;
    fixture.trace[8]["calls"][14]["ret"][0]["distance"] = json!(9);
    assert!(
        Replayer::default()
            .replay(&fixture)
            .expect_err("distance is observable")
            .to_string()
            .contains("value mismatch")
    );
    Ok(())
}

#[test]
fn nondiscrete_noop_keeps_metadata_across_clock_and_log_until_next_update() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(ORACLE)?;
    let index = fixture
        .trace
        .iter()
        .position(|op| op["op"] == "update")
        .expect("update");
    fixture.trace.splice(index..index, [
        json!({"op":"update","editor":0,"id":900,"cause":"test","calls":[],"opts":{"tag":"batch-only"}}),
        json!({"op":"clock","src":"perf","t":0}),
        json!({"op":"log","level":"warn","message":"batch observation"}),
    ]);
    let commit = fixture.trace[index + 3..]
        .iter_mut()
        .find(|op| op["op"] == "commit")
        .expect("commit");
    commit["updates"]
        .as_array_mut()
        .expect("updates")
        .insert(0, json!(900));
    commit["snapshot"]["tags"]
        .as_array_mut()
        .expect("tags")
        .insert(0, json!("batch-only"));
    Replayer::default().replay(&fixture)?;
    Ok(())
}
