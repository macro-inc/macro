//! Source nullish import defaults preserve other explicit-null node fields.
use lexical_model::Read;
use macro_document_model::{Result, comment_gate::content_without_comments};
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn nullish_import_defaults_match_service_without_omitting_other_nulls() -> Result<()> {
    let mut failures = Vec::new();
    for (node, expected_node, fields) in [
        (
            json!({"type":"pr-mention","version":1,"id":"https://github.com/example/project/pull/42","label":null,"url":""}),
            json!({"type":"pr-mention","version":1,"id":"","label":null,"url":"https://github.com/example/project/pull/42"}),
            &["mentionUuid"][..],
        ),
        (
            json!({"type":"agent-session-mention","version":3,"id":"agent-id","label":null,"expanded":false}),
            json!({"type":"agent-session-mention","version":3,"id":"agent-id","label":null}),
            &["mentionUuid"][..],
        ),
        (
            json!({"type":"date-mention","version":1,"date":null,"displayFormat":"Jan 1"}),
            json!({"type":"date-mention","version":1,"date":null,"displayFormat":"Jan 1"}),
            &["mentionUuid"][..],
        ),
        (
            json!({"type":"image","version":1,"srcType":"external","id":"media-id","url":null,"width":null,"height":60,"scale":1,"alt":"image"}),
            json!({"type":"image","version":1,"srcType":"external","id":"media-id","url":null,"width":null,"height":60,"scale":1,"alt":"image"}),
            &["constrainedWidth", "constrainedHeight"][..],
        ),
        (
            json!({"type":"video","version":1,"srcType":"external","id":"media-id","url":null,"width":null,"height":60,"scale":1,"controls":true}),
            json!({"type":"video","version":1,"srcType":"external","id":"media-id","url":null,"width":null,"height":60,"scale":1,"controls":true}),
            &["constrainedWidth", "constrainedHeight"][..],
        ),
    ] {
        for field in fields {
            let (concrete, empty) = match *field {
                "mentionUuid" => (json!("mention"), json!("")),
                "constrainedWidth" => (json!(320), json!(0)),
                "constrainedHeight" => (json!(180), json!(0)),
                _ => unreachable!("only the inventoried nullish fields"),
            };
            for value in [None, Some(Value::Null), Some(concrete), Some(empty)] {
                let mut input = node.clone();
                let mut expected = expected_node.clone();
                if let Some(value) = &value {
                    input[field] = value.clone();
                    if !value.is_null() {
                        expected[field] = value.clone();
                    }
                }
                if node["type"] != "image" && node["type"] != "video" {
                    input = json!({"type":"paragraph","version":1,"direction":null,"format":"","indent":0,"children":[input]});
                    expected = json!({"type":"paragraph","version":1,"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","children":[expected]});
                }
                let state = serde_json::from_value(json!({"root":{
                    "type":"root","version":1,"direction":null,"format":"","indent":0,"children":[input]
                }}))?;
                let actual = content_without_comments(&state)?;
                let expected = json!({"root":{
                    "type":"root","version":1,"direction":null,"format":"","indent":0,"children":[expected]
                }});
                if actual != expected {
                    failures.push((node["type"].clone(), *field, value, actual, expected));
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "Source import/export differences: {failures:#?}"
    );
    Ok(())
}

#[test]
fn service_json_entrypoints_do_not_change_unmarked_imports_or_updates() -> Result<()> {
    let context = macro_document_model::DocumentContext {
        clock: macro_document_model::NodeClock(Arc::new(|| 1794052800000)),
        random: macro_document_model::NodeRandom(Arc::new(|size| vec![0; size])),
        host: macro_document_model::NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    };
    for (mut node, fields) in [
        (
            json!({"type":"pr-mention","version":1,"id":"https://github.com/example/project/pull/42","label":null,"mentionUuid":null,"url":""}),
            &["mentionUuid"][..],
        ),
        (
            json!({"type":"agent-session-mention","version":3,"id":"agent-id","label":null,"mentionUuid":null}),
            &["mentionUuid"][..],
        ),
        (
            json!({"type":"date-mention","version":1,"date":null,"displayFormat":"Jan 1","mentionUuid":null}),
            &["mentionUuid"][..],
        ),
        (
            json!({"type":"image","version":1,"srcType":"external","id":"media-id","url":null,"width":null,"height":60,"scale":1,"alt":"image","constrainedWidth":null,"constrainedHeight":null}),
            &["constrainedWidth", "constrainedHeight"][..],
        ),
        (
            json!({"type":"video","version":1,"srcType":"external","id":"media-id","url":null,"width":null,"height":60,"scale":1,"controls":true,"constrainedWidth":null,"constrainedHeight":null}),
            &["constrainedWidth", "constrainedHeight"][..],
        ),
    ] {
        let block = node["type"] == "image" || node["type"] == "video";
        let child = if block {
            node.clone()
        } else {
            json!({"type":"paragraph","version":1,"children":[node]})
        };
        let input = serde_json::from_value(json!({"root":{
            "type":"root","version":1,"children":[child]
        }}))?;
        let gate = content_without_comments(&input)?;
        let export = serde_json::to_value(
            macro_document_model::export::parse_export_state(&input, &context)?.to_json()?,
        )?;
        let path = if block {
            "/root/children/0"
        } else {
            "/root/children/0/children/0"
        };
        for json in [&gate, &export] {
            let target = json.pointer(path).expect("service node");
            for field in fields {
                assert!(!target.as_object().expect("node").contains_key(*field));
            }
            let kept = if block {
                "width"
            } else if node["type"] == "date-mention" {
                "date"
            } else {
                "label"
            };
            assert_eq!(target.get(kept), Some(&Value::Null));
        }

        // A marked reader created earlier must not affect a later raw editor.
        let mut editor = macro_document_model::export_builder()
            .initial_state(input.clone())
            .build()?;
        let parsed = editor.parse_editor_state(&input)?;
        let unmarked = serde_json::to_value(parsed.to_json()?)?;
        for field in fields {
            assert_eq!(
                unmarked.pointer(path).expect("raw node").get(*field),
                Some(&Value::Null)
            );
        }
        let key = editor
            .state()
            .view()
            .descendants(lexical_model::NodeKey::ROOT)
            .find(|(key, _)| {
                editor
                    .state()
                    .export_json(*key)
                    .is_ok_and(|value| value.get("type") == node.get("type"))
            })
            .expect("raw node key")
            .0;
        for field in fields {
            let concrete = if *field == "mentionUuid" {
                json!("live")
            } else {
                json!(1)
            };
            node[field] = concrete;
            editor.update(|tx| tx.update_from_json(key, node.as_object().expect("node")))?;
            node[field] = Value::Null;
            editor.update(|tx| tx.update_from_json(key, node.as_object().expect("node")))?;
            assert_eq!(
                editor.state().export_json(key)?.get(*field),
                Some(&Value::Null)
            );
        }
    }
    Ok(())
}

#[test]
fn service_json_keeps_strict_gate_and_partial_export_error_policies() -> Result<()> {
    let context = macro_document_model::DocumentContext {
        clock: macro_document_model::NodeClock(Arc::new(|| 1794052800000)),
        random: macro_document_model::NodeRandom(Arc::new(|size| vec![0; size])),
        host: macro_document_model::NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    };
    for invalid in [
        json!({"type":"pr-mention","version":1,"id":"pr-id","mentionUuid":42}),
        json!({"type":"date-mention","version":1,"date":"2026-11-07","displayFormat":"Nov 7","mentionUuid":false}),
        json!({"type":"image","version":1,"constrainedWidth":"wide"}),
        json!({"type":"unknown-service-import-node","version":1}),
    ] {
        let input = serde_json::from_value(json!({"root":{
            "type":"root","version":1,"children":[{
                "type":"paragraph","version":1,"children":[{
                    "type":"text","version":1,"text":"retained"
                }]
            },invalid]
        }}))?;
        assert!(content_without_comments(&input).is_err());
        let partial = macro_document_model::export::parse_export_state(&input, &context)?;
        let json = serde_json::to_value(partial.to_json()?)?;
        let children = json["root"]["children"].as_array().expect("partial root");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0]["children"][0]["text"], "retained");
    }
    Ok(())
}
