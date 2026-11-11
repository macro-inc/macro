use super::*;
use crate::{EditorType, plugins_group_b::checklist_facts};
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};
use serde_json::{Value, json};

#[test]
fn fifty_lists_only_recompute_affected_members_and_ordinary_text_has_no_payload()
-> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let ((lists, rows, texts, outside), initial) = editor.update(|tx| {
        let mut lists = Vec::new();
        let mut rows = Vec::new();
        let mut texts = Vec::new();
        let mut outside = Vec::new();
        let mut roots = Vec::new();
        for _ in 0..50 {
            let list = tx.create(ListNode::new(ListType::Check, 1))?;
            let row = tx.create(ListItemNode::default())?;
            let text = tx.create_text("Work")?;
            tx.append(row, &[text.key()])?;
            tx.append(list, &[row.key()])?;
            let paragraph = tx.create(Paragraph::default())?;
            let separator = tx.create_text("Outside")?;
            tx.append(paragraph, &[separator.key()])?;
            roots.extend([list.key(), paragraph.key()]);
            lists.push(list.key());
            rows.push(row.key());
            texts.push(text.key());
            outside.push(separator.key());
        }
        tx.append(NodeKey::ROOT, &roots)?;
        Ok((lists, rows, texts, outside))
    })?;
    let mut producer = ChecklistProducer::default();
    producer.observe(&[initial]);
    assert!(producer.candidates.is_empty());
    assert!(producer.finish(editor.state())?.is_empty());
    let generation = editor.state().max_key().generation();
    let mut payload: Value =
        serde_json::from_str(include_str!("../checklist_query/request-example.json"))?;
    payload.as_object_mut().expect("object").remove("listKey");
    payload["factsVersion"] = json!("1");
    let command = crate::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )?
    .expect("command");
    let input = Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    };
    producer.accept(
        checklist_facts::input_revision(&input)?.expect("revision"),
        editor.state(),
    )?;
    let setup = producer.finish(editor.state())?;
    for receipt in &setup {
        producer.expose(receipt);
    }
    let setup = serde_json::to_value(&setup)?;
    assert_eq!(setup[0]["lists"].as_array().expect("lists").len(), 50);
    assert_eq!(producer.recomputed, 50);
    let (_, inside) = editor.update(|tx| {
        tx.text(texts[0])?.set_text_content("Workx")?;
        Ok(())
    })?;
    producer.observe(&[inside]);
    assert!(producer.finish(editor.state())?.is_empty());
    assert_eq!(producer.recomputed, 51);
    let (_, unrelated) = editor.update(|tx| {
        tx.text(outside[0])?.set_text_content("Outsidex")?;
        Ok(())
    })?;
    producer.observe(&[unrelated]);
    assert!(producer.finish(editor.state())?.is_empty());
    assert_eq!(producer.recomputed, 51);
    let (_, empty) = editor.update(|tx| {
        tx.text(texts[0])?.set_text_content("")?;
        Ok(())
    })?;
    producer.observe(&[empty]);
    let changed = producer.finish(editor.state())?;
    assert_eq!(producer.recomputed, 52);
    for receipt in &changed {
        producer.expose(receipt);
    }
    let changed = serde_json::to_value(&changed)?;
    assert_eq!(changed[0]["sequence"], "2");
    assert_eq!(changed[0]["lists"].as_array().expect("lists").len(), 1);
    assert_eq!(changed[0]["lists"][0]["listKey"]["index"], lists[0].index());
    assert_eq!(
        changed[0]["lists"][0]["changes"]["progress"],
        json!({"done":0,"total":0,"ratio":0.0,"percentage":0.0})
    );
    assert!(changed[0]["lists"][0]["changes"].get("items").is_none());
    assert!(changed[0]["lists"][0]["changes"].get("rows").is_none());
    assert!(
        serde_json::to_vec(&changed)?.len() < 4096,
        "component payload only; not a physical crossing proof"
    );
    payload["factsVersion"] = json!("2");
    payload["names"] = json!({"unreferenced":"New label"});
    let command = crate::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )?
    .expect("command");
    let input = Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    };
    producer.accept(
        checklist_facts::input_revision(&input)?.expect("revision"),
        editor.state(),
    )?;
    let refresh = serde_json::to_value(producer.finish(editor.state())?)?;
    assert_eq!(refresh[0]["factsVersion"], "2");
    assert_eq!(refresh[0]["sequence"], "3");
    assert_eq!(refresh[0]["lists"], json!([]));
    assert_eq!(producer.recomputed, 102);
    assert_eq!(producer.baseline.len(), 50);
    assert!(producer.candidates.is_empty());
    assert!(editor.state().view().contains(rows[0]));
    Ok(())
}

#[test]
fn producer_clear_is_distinct_from_never_configured_and_delivery_ids_do_not_reuse()
-> Result<(), Error> {
    let editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let mut producer = ChecklistProducer::default();
    producer.clear();
    assert!(producer.finish(editor.state())?.is_empty());
    let mut payload: Value =
        serde_json::from_str(include_str!("../checklist_query/request-example.json"))?;
    payload.as_object_mut().expect("object").remove("listKey");
    payload["factsVersion"] = json!("1");
    let command = crate::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        editor.state().max_key().generation(),
        None,
    )?
    .expect("command");
    let input = Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    };
    let revision = checklist_facts::input_revision(&input)?.expect("revision");
    producer.accept(revision, editor.state())?;
    let first = producer.finish(editor.state())?;
    for receipt in &first {
        producer.expose(receipt);
    }
    let first = serde_json::to_value(first)?;
    assert_eq!(first[0]["sequence"], "1");
    producer.clear();
    let cleared = producer.finish(editor.state())?;
    for receipt in &cleared {
        producer.expose(receipt);
    }
    let cleared = serde_json::to_value(cleared)?;
    assert_eq!(
        cleared[0],
        json!({"kind":"cleared","generation":editor.state().max_key().generation(),"sequence":"2"})
    );
    producer.accept(revision, editor.state())?;
    let rebound = serde_json::to_value(producer.finish(editor.state())?)?;
    assert_eq!(rebound[0]["sequence"], "3");
    assert_eq!(rebound[0]["reset"], true);
    producer.sequence = u64::MAX;
    producer.clear();
    assert!(producer.finish(editor.state()).is_err());
    assert_eq!(producer.sequence, u64::MAX);
    assert!(producer.accept(revision, editor.state()).is_err());
    assert!(producer.facts.is_none());
    Ok(())
}

#[test]
fn keyed_row_and_item_replay_preserves_crossed_moves_and_first_seen_name_association()
-> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let ((list, rows), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let mut rows = Vec::new();
        for (id, name) in [
            ("shared", "First"),
            ("other", "Other"),
            ("shared", "Later"),
            ("last", "Last"),
        ] {
            let row = tx.create(ListItemNode::default())?;
            let mention = tx.create(crate::nodes::UserMentionNode {
                user_id: crate::nodes::Maybe::Value(id.into()),
                display_name: name.into(),
                ..Default::default()
            })?;
            tx.append(row, &[mention.key()])?;
            rows.push(row.key());
        }
        tx.append(list, &rows)?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        Ok((list.key(), rows))
    })?;
    let mut payload: Value =
        serde_json::from_str(include_str!("../checklist_query/request-example.json"))?;
    payload.as_object_mut().expect("object").remove("listKey");
    payload["factsVersion"] = json!("1");
    let command = crate::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        editor.state().max_key().generation(),
        None,
    )?
    .expect("command");
    let input = Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    };
    let revision = checklist_facts::input_revision(&input)?.expect("revision");
    let mut producer = ChecklistProducer::default();
    producer.accept(revision, editor.state())?;
    let initial = producer.finish(editor.state())?;
    for receipt in &initial {
        producer.expose(receipt);
    }
    let initial = serde_json::to_value(initial)?;
    let mut replay_rows = initial[0]["lists"][0]["result"]["rows"]
        .as_array()
        .expect("rows")
        .clone();
    let mut replay_items = initial[0]["lists"][0]["result"]["items"]
        .as_array()
        .expect("items")
        .clone();
    let (_, moved) = editor.update(|tx| tx.append(list, &[rows[2], rows[3], rows[0], rows[1]]))?;
    producer.observe(&[moved]);
    let delta = serde_json::to_value(producer.finish(editor.state())?)?;
    for (section, values) in [("rows", &mut replay_rows), ("items", &mut replay_items)] {
        for operation in delta[0]["lists"][0]["changes"][section]
            .as_array()
            .expect("operations")
        {
            match operation["kind"].as_str().expect("kind") {
                "remove" => {
                    let index = values
                        .iter()
                        .position(|value| value["key"] == operation["key"])
                        .expect("existing");
                    values.remove(index);
                }
                "place" => {
                    let value = if section == "rows" {
                        json!({"key":operation["key"],"dimmed":operation["dimmed"]})
                    } else {
                        operation["item"].clone()
                    };
                    if let Some(index) = values.iter().position(|old| old["key"] == value["key"]) {
                        values.remove(index);
                    }
                    let at = if operation["after"].is_null() {
                        0
                    } else {
                        values
                            .iter()
                            .position(|old| old["key"] == operation["after"])
                            .expect("anchor")
                            + 1
                    };
                    values.insert(at, value);
                }
                "dim" => {
                    let value = values
                        .iter_mut()
                        .find(|value| value["key"] == operation["key"])
                        .expect("row");
                    value["dimmed"] = operation["dimmed"].clone();
                }
                "update" => {
                    let value = values
                        .iter_mut()
                        .find(|value| value["key"] == operation["item"]["key"])
                        .expect("item");
                    *value = operation["item"].clone();
                }
                other => panic!("unexpected {other}"),
            }
        }
    }
    let mut fresh = ChecklistProducer::default();
    fresh.accept(revision, editor.state())?;
    let complete = serde_json::to_value(fresh.finish(editor.state())?)?;
    assert_eq!(
        json!(replay_rows),
        complete[0]["lists"][0]["result"]["rows"]
    );
    assert_eq!(
        json!(replay_items),
        complete[0]["lists"][0]["result"]["items"]
    );
    assert_eq!(replay_items[0]["assignees"][0]["name"], "Later");
    assert_eq!(replay_items[2]["assignees"][0]["name"], "First");
    assert!(replay_items.iter().all(|item| item.get("text").is_none()));
    Ok(())
}

#[test]
fn transfer_receipts_retry_exactly_and_remount_drafts_do_not_ack_failed_transfers()
-> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let ((list, text), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let row = tx.create(ListItemNode::default())?;
        let text = tx.create_text("Work")?;
        tx.append(row, &[text.key()])?;
        tx.append(list, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        Ok((list.key(), text.key()))
    })?;
    let mut payload: Value =
        serde_json::from_str(include_str!("../checklist_query/request-example.json"))?;
    payload.as_object_mut().expect("object").remove("listKey");
    payload["factsVersion"] = json!("1");
    let command = crate::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        editor.state().max_key().generation(),
        None,
    )?
    .expect("command");
    let input = Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    };
    let revision = checklist_facts::input_revision(&input)?.expect("revision");
    let mut producer = ChecklistProducer::default();
    producer.accept(revision, editor.state())?;
    let first = producer.finish(editor.state())?;
    assert!(
        producer.baseline.is_empty(),
        "finishing output is not transfer"
    );
    producer.accept(revision, editor.state())?;
    let retry = producer.finish(editor.state())?;
    assert_eq!(serde_json::to_value(&first)?, serde_json::to_value(&retry)?);
    assert!(Arc::ptr_eq(&first[0].1, &retry[0].1));
    let failed_draft = producer.prepare_reset(editor.state())?;
    assert_eq!(
        serde_json::to_value(failed_draft.deliveries())?[0]["sequence"],
        "2"
    );
    drop(failed_draft); // A failed encoder/observer never reaches expose_reset.
    assert_eq!(producer.sequence, 1);
    assert!(producer.baseline.is_empty());
    let (_, changed) = editor.update(|tx| {
        tx.text(text)?.set_text_content("")?;
        Ok(())
    })?;
    producer.observe(&[changed]);
    let pending = producer.finish(editor.state())?;
    assert_eq!(pending.len(), 2);
    producer.expose(&pending[1]);
    assert!(
        producer.baseline.is_empty(),
        "out-of-order receipt cannot acknowledge an omitted prefix"
    );
    let mut other = ChecklistProducer::default();
    other.accept(revision, editor.state())?;
    let foreign = other.finish(editor.state())?;
    producer.expose(&foreign[0]);
    assert!(
        producer.baseline.is_empty(),
        "same sequence from another producer is not authority"
    );
    producer.expose(&pending[0]);
    assert!(producer.baseline.contains_key(&list));
    assert_eq!(producer.pending.len(), 1);
    let draft = producer.prepare_reset(editor.state())?;
    let reset = serde_json::to_value(draft.deliveries())?;
    assert_eq!(reset[0]["sequence"], "3");
    assert_eq!(reset[0]["reset"], true);
    assert_eq!(reset[0]["lists"][0]["result"]["progress"]["total"], 0);
    producer.expose_reset(draft);
    assert!(producer.pending.is_empty());
    producer.expose(&pending[1]); // Superseded receipt cannot change reset baseline.
    assert!(producer.finish(editor.state())?.is_empty());
    assert_eq!(producer.sequence, 3);
    payload["factsVersion"] = json!("2");
    let command = crate::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        editor.state().max_key().generation(),
        None,
    )?
    .expect("revision two");
    let input = Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    };
    producer.accept(
        checklist_facts::input_revision(&input)?.expect("revision"),
        editor.state(),
    )?;
    let before_clear = producer.finish(editor.state())?;
    assert_eq!(serde_json::to_value(&before_clear)?[0]["sequence"], "4");
    producer.clear();
    let retained = producer.finish(editor.state())?;
    assert_eq!(
        retained.len(),
        2,
        "binding clear preserves untransferred ordered receipt debt"
    );
    assert_eq!(serde_json::to_value(&retained)?[1]["kind"], "cleared");
    assert_eq!(serde_json::to_value(&retained)?[1]["sequence"], "5");
    assert!(
        producer.baseline.contains_key(&list),
        "clear is not a transfer"
    );
    producer.expose(&retained[1]);
    assert!(producer.baseline.contains_key(&list));
    producer.expose(&retained[0]);
    assert!(producer.baseline.contains_key(&list));
    producer.expose(&retained[1]);
    assert!(producer.baseline.is_empty());
    assert!(producer.pending.is_empty());
    assert_eq!(producer.sequence, 5);
    Ok(())
}
