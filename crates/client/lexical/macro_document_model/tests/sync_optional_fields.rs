//! Independent source exportJSON cases for unset decorator and element fields.
use lexical_loro::{LoroProjection, PlainPolicy, new_doc, reconstruct_state};
use loro::ExportMode;
use macro_document_model::{Result, headless_builder, sync::MACRO_SYNC_POLICY};
use serde_json::{Value, json};

#[test]
fn source_optional_fields_attach_on_a_fresh_peer_without_erasing_stored_nulls() -> Result<()> {
    for (node, field, keeps_null) in [
        (
            json!({"type":"pr-mention","version":1,"url":null}),
            "url",
            false,
        ),
        (
            json!({"type":"classed-block","version":1,"tag":"div","classes":[],"attributes":null,"children":[]}),
            "attributes",
            false,
        ),
        (
            json!({"type":"await","version":1,"awaitId":"await-fixture","text":null,"inline":true}),
            "text",
            true,
        ),
    ] {
        let original = headless_builder()
            .initial_state(serde_json::from_value(json!({"root":{
                "type":"root","version":1,"children":[{
                    "type":"paragraph","version":1,"children":[node]
                }]
            }}))?)
            .build()?;
        let expected = original.state().to_json()?;
        let exported = &expected.root["children"][0]["children"][0];
        if keeps_null {
            assert_eq!(exported.get(field), Some(&Value::Null));
        } else {
            assert!(exported.get(field).is_none());
        }
        let mut persisted = expected.clone();
        persisted.root["children"][0]["children"][0][field] = Value::Null;
        let writer = new_doc(93)?;
        lexical_loro::mirror::set_synced_state(&writer, &persisted, &PlainPolicy)?;
        let snapshot = writer
            .export(ExportMode::Snapshot)
            .expect("source snapshot");
        drop(original);
        drop(writer);
        let doc = new_doc(94)?;
        doc.import(&snapshot).expect("fresh peer import");
        let raw = doc.get_deep_value();
        let vv = doc.oplog_vv();
        let state = reconstruct_state(&doc, &MACRO_SYNC_POLICY)?;
        let fresh = headless_builder().initial_state(state).build()?;
        assert_eq!(fresh.state().to_json()?, expected);
        LoroProjection::attach(&doc, fresh.state(), &MACRO_SYNC_POLICY)?;
        assert_eq!(doc.get_deep_value(), raw);
        assert_eq!(doc.oplog_vv(), vv);
    }
    Ok(())
}

#[test]
fn nullable_await_text_never_authorizes_other_types_or_malformed_values() -> Result<()> {
    for ty in ["await", "text", "paragraph", "unknown"] {
        for value in [Value::Null, json!(false), json!(3), json!([]), json!({})] {
            let raw = serde_json::from_value(json!({"root":{
                "type":"root","version":1,"children":[{
                    "type":ty,"version":1,"text":value
                }]
            }}))?;
            let doc = new_doc(95)?;
            lexical_loro::mirror::set_synced_state(&doc, &raw, &PlainPolicy)?;
            assert!(reconstruct_state(&doc, &PlainPolicy).is_err());
            if ty == "await" && value.is_null() {
                let state = reconstruct_state(&doc, &MACRO_SYNC_POLICY)?;
                assert_eq!(state.root["children"][0].get("text"), Some(&Value::Null));
            } else {
                assert!(reconstruct_state(&doc, &MACRO_SYNC_POLICY).is_err());
            }
        }
    }
    Ok(())
}

#[test]
fn optional_omission_aliases_leave_nonnull_and_unrelated_fields_strict() {
    use lexical_loro::SyncPolicy;
    for (ty, field) in [("pr-mention", "url"), ("classed-block", "attributes")] {
        for value in [
            Value::Null,
            json!(""),
            json!({"nested":null}),
            json!([null]),
        ] {
            let mut node = serde_json::Map::from_iter([
                ("type".to_owned(), json!(ty)),
                (field.to_owned(), value.clone()),
                ("unknown".to_owned(), Value::Null),
            ]);
            MACRO_SYNC_POLICY.canonicalize_node_json(&mut node);
            if value.is_null() {
                assert!(!node.contains_key(field));
            } else {
                assert_eq!(node.get(field), Some(&value));
            }
            assert_eq!(node.get("unknown"), Some(&Value::Null));
        }
    }
}

#[test]
fn nullable_await_text_projects_local_changes_without_coercing_null() -> Result<()> {
    use macro_document_model::nodes::{AwaitNode, Maybe};
    let mut editor = headless_builder()
        .initial_state(serde_json::from_value(json!({"root":{
            "type":"root","version":1,"children":[{
                "type":"paragraph","version":1,"children":[{
                    "type":"await","version":1,"awaitId":"await-fixture","text":null
                }]
            }]
        }}))?)
        .build()?;
    let key = lexical_rich_nodes::utils::dfs(editor.state().view(), None, None)
        .into_iter()
        .find(|entry| editor.state().view().is::<AwaitNode>(entry.node))
        .expect("actual await node")
        .node;
    let doc = new_doc(96)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    for (text, now) in [(Maybe::Value("loading".to_owned()), 1), (Maybe::Null, 2)] {
        let (_, commit) = editor.update(|tx| {
            tx.get_mut::<AwaitNode>(key)?.text = text;
            Ok(())
        })?;
        projection.local_commit(&doc, &[commit], lexical_loro::LOCAL_ORIGIN, now)?;
        projection
            .check(&doc, editor.state())
            .expect("actual indexed projection");
        assert_eq!(
            reconstruct_state(&doc, &MACRO_SYNC_POLICY)?,
            editor.state().to_json()?
        );
    }
    Ok(())
}
