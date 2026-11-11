use super::*;
use crate::EditorType;
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};

#[test]
fn query_collects_current_metadata_without_host_settings_or_state_mutation() -> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let ((list, row), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let row = tx.create(ListItemNode {
            checked: Some(true),
            ..Default::default()
        })?;
        let text = tx.create_text("work!")?;
        tx.append(row, &[text.key()])?;
        tx.append(list, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        Ok((list.key(), row.key()))
    })?;
    let before = editor.state().to_json()?;
    let request = json!({"listKey":list.index(),"tasks":{},"names":{},"calendar":{
        "today":{"instantMs":0,"local":{"year":1970,"month":1,"day":1,"hour":0,"minute":0,"second":0,"millisecond":0},
        "startOfDay":{"kind":"valid","instantMs":0,"local":{"year":1970,"month":1,"day":1,"hour":0,"minute":0,"second":0,"millisecond":0}}},"dueDates":{}}});
    let result = crate::surface::query(
        "group-b.checklist-plan",
        &request,
        list.generation(),
        editor.state(),
    )?
    .expect("registered query");
    assert_eq!(result["kind"], "planned");
    assert_eq!(
        result["progress"],
        json!({"done":1,"total":1,"ratio":1.0,"percentage":100.0})
    );
    assert_eq!(result["items"][0]["key"], key(row));
    assert_eq!(result["items"][0]["priority"], "medium");
    assert_eq!(editor.state().to_json()?, before);
    assert!(
        query(
            "group-b.checklist-plan",
            &Value::Null,
            list.generation() + 1,
            editor.state()
        )
        .is_err()
    );
    for target in [0, row.index(), u32::MAX] {
        let mut bad = request.clone();
        bad["listKey"] = json!(target);
        assert!(
            query(
                "group-b.checklist-plan",
                &bad,
                list.generation(),
                editor.state()
            )
            .is_err()
        );
    }
    let mut invented = request.clone();
    invented["settings"] = json!({});
    assert!(
        query(
            "group-b.checklist-plan",
            &invented,
            list.generation(),
            editor.state()
        )
        .is_err()
    );
    assert_eq!(
        query("unknown", &Value::Null, list.generation(), editor.state())?,
        None
    );
    let nested = editor
        .update(|tx| {
            let wrapper = tx.create(ListItemNode::default())?;
            let nested = tx.create(ListNode::new(ListType::Check, 1))?;
            let nested_row = tx.create(ListItemNode::default())?;
            tx.append(nested, &[nested_row.key()])?;
            tx.append(wrapper, &[nested.key()])?;
            tx.append(list, &[wrapper.key()])?;
            Ok(nested.key())
        })?
        .0;
    let mut nested_request = request.clone();
    nested_request["listKey"] = json!(nested.index());
    assert!(
        query(
            "group-b.checklist-plan",
            &nested_request,
            list.generation(),
            editor.state()
        )
        .is_err()
    );
    editor.update(|tx| {
        crate::nodes::set_task_list_view_settings(
            tx,
            list,
            std::sync::Arc::new(json!({"filters":{"status":42},"future":"retained"})),
        )
    })?;
    let unsupported = query(
        "group-b.checklist-plan",
        &request,
        list.generation(),
        editor.state(),
    )?
    .expect("reply");
    assert_eq!(unsupported["kind"], "unsupportedInput");
    assert_eq!(
        unsupported["settingsContext"],
        json!({"filters":{"status":42},"future":"retained"})
    );
    assert!(unsupported.get("items").is_none());
    editor.update(|tx| {
        crate::nodes::set_task_list_view_settings(tx, list, std::sync::Arc::new(Value::Null))
    })?;
    let mut invalid = request.clone();
    invalid["calendar"]["today"]["local"]["month"] = json!(13);
    let invalid = query(
        "group-b.checklist-plan",
        &invalid,
        list.generation(),
        editor.state(),
    )?
    .expect("reply");
    assert_eq!(invalid["kind"], "invalidCalendarFacts");
    assert_eq!(invalid["problem"]["kind"], "invalidCivilDate");
    let mut malformed = request;
    malformed["calendar"]["today"]["local"]["future"] = json!(1);
    assert!(
        query(
            "group-b.checklist-plan",
            &malformed,
            list.generation(),
            editor.state()
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn explicit_provider_facts_are_request_scoped_and_preserve_source_calendar_failures()
-> Result<(), Error> {
    let mut editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("registry");
    let (list, _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let row = tx.create(ListItemNode::default())?;
        let task = tx.create(crate::nodes::DocumentMentionNode {
            document_id: Maybe::Value("task-a".into()),
            document_name: Maybe::Value("Task".into()),
            block_name: Maybe::Value("task".into()),
            ..Default::default()
        })?;
        tx.append(row, &[task.key()])?;
        tx.append(list, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        crate::nodes::set_task_list_view_settings(
            tx,
            list.key(),
            std::sync::Arc::new(json!({"filters":{"due":["later"]}})),
        )?;
        Ok(list.key())
    })?;
    let mut request: Value = serde_json::from_str(include_str!("request-example.json"))?;
    request["listKey"] = json!(list.index());
    request["tasks"] = json!({"task-a":{"statusOptionId":null,"priorityOptionId":null,"assigneeIds":["__proto__"],"due":"minimum"}});
    request["names"] = json!({"__proto__":"Resolved"});
    request["calendar"]["dueDates"] = json!({"minimum":{"kind":"valid","observation":{"instantMs":-8640000000000000_i64,"local":{"year":-271821,"month":4,"day":19,"hour":19,"minute":3,"second":58,"millisecond":0},"startOfDay":{"kind":"invalid"}}}});
    let result = query(
        "group-b.checklist-plan",
        &request,
        list.generation(),
        editor.state(),
    )?
    .expect("reply");
    assert_eq!(result["kind"], "planned");
    assert_eq!(result["rows"][0]["dimmed"], false);
    assert_eq!(
        result["items"][0]["assignees"],
        json!([{"id":{"kind":"value","value":"__proto__"},"name":"Resolved"}])
    );
    assert_eq!(
        result["items"][0]["taskId"],
        json!({"kind":"value","value":"task-a"})
    );
    request["tasks"]["task-a"]["statusOptionId"] = json!("constructor");
    let unsupported = query(
        "group-b.checklist-plan",
        &request,
        list.generation(),
        editor.state(),
    )?
    .expect("reply");
    assert_eq!(unsupported["kind"], "unsupportedInput");
    assert_eq!(unsupported["field"], "task.statusOptionId");
    assert_eq!(
        unsupported["settingsContext"],
        json!({"filters":{"due":["later"]}})
    );
    request["tasks"] = json!({});
    let without = query(
        "group-b.checklist-plan",
        &request,
        list.generation(),
        editor.state(),
    )?
    .expect("reply");
    assert_eq!(without["kind"], "planned");
    assert_eq!(without["items"][0]["assignees"], json!([]));
    assert_eq!(without["items"][0]["due"], json!({"kind":"null"}));
    assert_eq!(without["rows"][0]["dimmed"], true);
    request["tasks"] = json!({"task-a":{"statusOptionId":null,"priorityOptionId":null,"assigneeIds":[],"due":"unobserved"}});
    let missing = query(
        "group-b.checklist-plan",
        &request,
        list.generation(),
        editor.state(),
    )?
    .expect("reply");
    assert_eq!(missing["kind"], "invalidCalendarFacts");
    assert_eq!(
        missing["problem"],
        json!({"kind":"missingDueObservation","due":"unobserved"})
    );
    Ok(())
}
