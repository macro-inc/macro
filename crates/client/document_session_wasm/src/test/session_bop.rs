//! Literal cross-language codec samples, including values outside JS Number precision.
use super::super::*;
fn sample_session_config_msg() -> wire::SessionConfigMsg {
    wire::SessionConfigMsg {
        doc: "fixture 😀 é".into(),
        session: "fixture 😀 é".into(),
        user: "fixture 😀 é".into(),
        peers: vec![9_007_199_254_740_993],
        access: wire::Access::Read,
        transport: wire::Transport::None,
        durable: true,
        chatter: true,
        headless: true,
        view_engine: 0,
        view_os: 0,
        token: "fixture 😀 é".into(),
        traceparent: "fixture 😀 é".into(),
        coalesce: 7,
        snapshot_interval: 7,
        observed: vec![sample_container_path_msg()],
    }
}
fn sample_point_msg() -> wire::PointMsg {
    wire::PointMsg {
        key: 7,
        offset: 7,
        _type: 0,
    }
}
fn sample_selection_msg() -> wire::SelectionMsg {
    wire::SelectionMsg {
        kind: 0,
        anchor: sample_point_msg(),
        focus: sample_point_msg(),
        nodes: vec![7],
        table: 7,
        dirty: true,
    }
}
fn sample_clipboard_entry_msg() -> wire::ClipboardEntryMsg {
    wire::ClipboardEntryMsg {
        mime: "fixture 😀 é".into(),
        value: "fixture 😀 é".into(),
    }
}
fn sample_modify_target_msg() -> wire::ModifyTargetMsg {
    wire::ModifyTargetMsg {
        kind: 0,
        anchor: sample_point_msg(),
        focus: sample_point_msg(),
        dirty: true,
        backward: true,
    }
}
fn sample_marked_selection_msg() -> wire::MarkedSelectionMsg {
    wire::MarkedSelectionMsg {
        format: 7,
        style: "fixture 😀 é".into(),
        anchor: sample_point_msg(),
    }
}
fn sample_range_selection_msg() -> wire::RangeSelectionMsg {
    wire::RangeSelectionMsg {
        anchor: sample_point_msg(),
        focus: sample_point_msg(),
        format: 7,
        style: "fixture 😀 é".into(),
    }
}
fn sample_path_step_msg() -> wire::PathStepMsg {
    wire::PathStepMsg {
        kind: 0,
        key: "fixture 😀 é".into(),
        index: 7,
    }
}
fn sample_container_path_msg() -> wire::ContainerPathMsg {
    wire::ContainerPathMsg {
        root: "fixture 😀 é".into(),
        steps: vec![sample_path_step_msg()],
    }
}
fn sample_doc_value_node() -> wire::DocValueNode {
    wire::DocValueNode {
        kind: 0,
        key: "fixture 😀 é".into(),
        num: 1.25,
        int: i64::MIN,
        str: "fixture 😀 é".into(),
        bytes: vec![0, 127, 255],
        children: 7,
    }
}
fn sample_doc_op_msg() -> wire::DocOpMsg {
    wire::DocOpMsg {
        kind: 0,
        path: sample_container_path_msg(),
        key: "fixture 😀 é".into(),
        index: 7,
        len: 7,
        value: vec![sample_doc_value_node()],
    }
}
fn sample_session_input_msg() -> wire::SessionInputMsg {
    wire::SessionInputMsg {
        kind: 0,
        request: 7,
        code: 0,
        flag: true,
        bytes: vec![0, 127, 255],
        peers: vec![9_007_199_254_740_993],
        editor: sample_editor_input_msg(),
        operations: vec![sample_doc_op_msg()],
        mark_id: "fixture 😀 é".into(),
        anchor: vec![0, 127, 255],
        focus: vec![0, 127, 255],
        expected_text: "fixture 😀 é".into(),
    }
}
fn sample_connect_msg() -> wire::ConnectMsg {
    wire::ConnectMsg {
        doc: "fixture 😀 é".into(),
        token: "fixture 😀 é".into(),
        traceparent: "fixture 😀 é".into(),
    }
}
fn sample_wal_record_msg() -> wire::WalRecordMsg {
    wire::WalRecordMsg {
        seq: 9_007_199_254_740_993,
        created_at: i64::MIN,
        user: "fixture 😀 é".into(),
        foreign: true,
        quarantined: true,
        delivered: true,
        bytes: vec![0, 127, 255],
    }
}
fn sample_owner_rows_msg() -> wire::OwnerRowsMsg {
    wire::OwnerRowsMsg {
        owner: "fixture 😀 é".into(),
        records: vec![sample_wal_record_msg()],
    }
}
fn sample_local_state_msg() -> wire::LocalStateMsg {
    wire::LocalStateMsg {
        snapshot: vec![0, 127, 255],
        covers_owner: "fixture 😀 é".into(),
        covers_seq: 9_007_199_254_740_993,
        orphans: vec![sample_owner_rows_msg()],
        assist: vec![sample_owner_rows_msg()],
    }
}
fn sample_storage_op_msg() -> wire::StorageOpMsg {
    wire::StorageOpMsg {
        kind: 0,
        doc: "fixture 😀 é".into(),
        owner: "fixture 😀 é".into(),
        user: "fixture 😀 é".into(),
        from: "fixture 😀 é".into(),
        seq: 9_007_199_254_740_993,
        through: 9_007_199_254_740_993,
        before: i64::MIN,
        retry: true,
        terminal: true,
        record: sample_wal_record_msg(),
        snapshot: vec![0, 127, 255],
        covers_owner: "fixture 😀 é".into(),
        covers_seq: 9_007_199_254_740_993,
        expected: vec![sample_wal_record_msg()],
    }
}
fn sample_attr_msg() -> wire::AttrMsg {
    wire::AttrMsg {
        key: "fixture 😀 é".into(),
        kind: 0,
        text: "fixture 😀 é".into(),
        unsigned: 9_007_199_254_740_993,
        signed: i64::MIN,
        flag: true,
    }
}
fn sample_telemetry_msg() -> wire::TelemetryMsg {
    wire::TelemetryMsg {
        parent: 0,
        span: 9_007_199_254_740_993,
        kind: 0,
        name: "fixture 😀 é".into(),
        outcome: "fixture 😀 é".into(),
        error: true,
        attrs: vec![sample_attr_msg()],
    }
}
fn sample_node_cursor_msg() -> wire::NodeCursorMsg {
    wire::NodeCursorMsg {
        node_id: "fixture 😀 é".into(),
        cursor: vec![0, 127, 255],
    }
}
fn sample_doc_event_msg() -> wire::DocEventMsg {
    wire::DocEventMsg {
        kind: 0,
        path: sample_container_path_msg(),
        changes: vec![sample_doc_op_msg()],
    }
}
fn sample_view_effect_msg() -> wire::ViewEffectMsg {
    wire::ViewEffectMsg {
        kind: 0,
        request: 7,
        code: 7,
        detail: 7,
        flag: true,
        text: "fixture 😀 é".into(),
        selection: sample_selection_msg(),
        format: 7,
        style: "fixture 😀 é".into(),
        keys: vec!["fixture 😀 é".into()],
        values: vec![sample_doc_value_node()],
        events: vec![sample_doc_event_msg()],
        paths: vec![sample_container_path_msg()],
        closed_reason: wire::ClosedReason::Unauthorized,
        save_reason: wire::SaveReason::ReadOnly,
    }
}
fn sample_query_msg() -> wire::QueryMsg {
    wire::QueryMsg {
        kind: 0,
        key: 7,
        text: "fixture 😀 é".into(),
        flags: 7,
    }
}
fn sample_query_reply_msg() -> wire::QueryReplyMsg {
    wire::QueryReplyMsg {
        text: "fixture 😀 é".into(),
        count: 7,
        keys: vec![7],
        nodes: vec!["fixture 😀 é".into()],
        points: vec![sample_point_msg()],
    }
}
fn sample_clipboard_msg() -> wire::ClipboardMsg {
    wire::ClipboardMsg {
        html: "fixture 😀 é".into(),
        lexical: "fixture 😀 é".into(),
        plain: "fixture 😀 é".into(),
    }
}
fn sample_type_row_msg() -> wire::TypeRowMsg {
    wire::TypeRowMsg {
        index: 7,
        name: "fixture 😀 é".into(),
        kind: 0,
        flags: 7,
    }
}
fn sample_type_table_msg() -> wire::TypeTableMsg {
    wire::TypeTableMsg {
        rows: vec![sample_type_row_msg()],
    }
}
fn sample_listener_row_msg() -> wire::ListenerRowMsg {
    wire::ListenerRowMsg {
        command: "fixture 😀 é".into(),
        priority: 7,
    }
}
fn sample_listener_table_msg() -> wire::ListenerTableMsg {
    wire::ListenerTableMsg {
        rows: vec![sample_listener_row_msg()],
    }
}
fn sample_route_msg() -> wire::RouteMsg {
    wire::RouteMsg {
        doc: "fixture 😀 é".into(),
        kind: 0,
        conn: 7,
        access: 0,
        code: 7,
        frame: vec![0, 127, 255],
    }
}
fn sample_selection_change_msg() -> wire::SelectionChangeMsg {
    wire::SelectionChangeMsg {
        triple_click: Some(true),
        dom_range_same_node: Some(true),
        marked: Some(sample_marked_selection_msg()),
        dom_anchor_offset: Some(7),
        dom_focus_offset: Some(7),
        post_delete_restore: Some(sample_range_selection_msg()),
    }
}
fn sample_editor_input_msg() -> wire::EditorInputMsg {
    wire::EditorInputMsg::EditorSetState {
        json: "fixture 😀 é".into(),
    }
}
#[test]
fn input_output_round_trip() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/collaboration/tests/abi");
    let record = std::env::var_os("RECORD_SESSION_ABI").is_some();
    let mut cases = vec![];
    {
        let value = sample_session_config_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::SessionConfigMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"SessionConfigMsg","bytes":data}));
    }
    {
        let value = sample_point_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::PointMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"PointMsg","bytes":data}));
    }
    {
        let value = sample_selection_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::SelectionMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"SelectionMsg","bytes":data}));
    }
    {
        let value = sample_clipboard_entry_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::ClipboardEntryMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"ClipboardEntryMsg","bytes":data}));
    }
    {
        let value = sample_modify_target_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::ModifyTargetMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"ModifyTargetMsg","bytes":data}));
    }
    {
        let value = sample_marked_selection_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::MarkedSelectionMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"MarkedSelectionMsg","bytes":data}));
    }
    {
        let value = sample_range_selection_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::RangeSelectionMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"RangeSelectionMsg","bytes":data}));
    }
    {
        let value = sample_path_step_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::PathStepMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"PathStepMsg","bytes":data}));
    }
    {
        let value = sample_container_path_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::ContainerPathMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"ContainerPathMsg","bytes":data}));
    }
    {
        let value = sample_doc_value_node();
        let data = bytes(&value).unwrap();
        let decoded = wire::DocValueNode::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"DocValueNode","bytes":data}));
    }
    {
        let value = sample_doc_op_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::DocOpMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"DocOpMsg","bytes":data}));
    }
    {
        let value = sample_session_input_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::SessionInputMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"SessionInputMsg","bytes":data}));
    }
    {
        let value = sample_connect_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::ConnectMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"ConnectMsg","bytes":data}));
    }
    {
        let value = sample_wal_record_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::WalRecordMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"WalRecordMsg","bytes":data}));
    }
    {
        let value = sample_owner_rows_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::OwnerRowsMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"OwnerRowsMsg","bytes":data}));
    }
    {
        let value = sample_local_state_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::LocalStateMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"LocalStateMsg","bytes":data}));
    }
    {
        let value = sample_storage_op_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::StorageOpMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"StorageOpMsg","bytes":data}));
    }
    {
        let value = sample_attr_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::AttrMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"AttrMsg","bytes":data}));
    }
    {
        let value = sample_telemetry_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::TelemetryMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"TelemetryMsg","bytes":data}));
    }
    {
        let value = sample_node_cursor_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::NodeCursorMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"NodeCursorMsg","bytes":data}));
    }
    {
        let value = sample_doc_event_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::DocEventMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"DocEventMsg","bytes":data}));
    }
    {
        let value = sample_view_effect_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::ViewEffectMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"ViewEffectMsg","bytes":data}));
    }
    {
        let value = sample_query_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::QueryMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"QueryMsg","bytes":data}));
    }
    {
        let value = sample_query_reply_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::QueryReplyMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"QueryReplyMsg","bytes":data}));
    }
    {
        let value = sample_clipboard_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::ClipboardMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"ClipboardMsg","bytes":data}));
    }
    {
        let value = sample_type_row_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::TypeRowMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"TypeRowMsg","bytes":data}));
    }
    {
        let value = sample_type_table_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::TypeTableMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"TypeTableMsg","bytes":data}));
    }
    {
        let value = sample_listener_row_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::ListenerRowMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"ListenerRowMsg","bytes":data}));
    }
    {
        let value = sample_listener_table_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::ListenerTableMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"ListenerTableMsg","bytes":data}));
    }
    {
        let value = sample_route_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::RouteMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"RouteMsg","bytes":data}));
    }
    {
        let value = sample_selection_change_msg();
        let data = bytes(&value).unwrap();
        let decoded = wire::SelectionChangeMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"SelectionChangeMsg","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorCommand {
            command: wire::CommandCode::InsertText,
            a: 7,
            b: 7,
            text: "fixture 😀 é".into(),
            selection: sample_selection_msg(),
            target: sample_modify_target_msg(),
            character_target: sample_modify_target_msg(),
        };
        let data = bytes(&value).unwrap();
        let decoded = wire::EditorInputMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorCommand","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorSetState {
            json: "fixture 😀 é".into(),
        };
        let data = bytes(&value).unwrap();
        let decoded = wire::EditorInputMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorSetState","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorSelection {
            selection: sample_selection_msg(),
            change: sample_selection_change_msg(),
        };
        let data = bytes(&value).unwrap();
        let decoded = wire::EditorInputMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorSelection","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorPaste {
            selection: sample_selection_msg(),
            clipboard: vec![sample_clipboard_entry_msg()],
            has_files: true,
            html_nodes: vec!["fixture 😀 é".into()],
        };
        let data = bytes(&value).unwrap();
        let decoded = wire::EditorInputMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorPaste","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorInsertText {
            phase: 0,
            has_data: true,
            data: "fixture 😀 é".into(),
            has_transfer: true,
            transfer: "fixture 😀 é".into(),
            facts: 7,
            last_key: "fixture 😀 é".into(),
            selection: sample_selection_msg(),
        };
        let data = bytes(&value).unwrap();
        let decoded = wire::EditorInputMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorInsertText","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorComposition {
            kind: 0,
            key: 7,
            text: "fixture 😀 é".into(),
            anchor_offset: 7,
            focus_offset: 7,
            data: "fixture 😀 é".into(),
            selection: sample_selection_msg(),
        };
        let data = bytes(&value).unwrap();
        let decoded = wire::EditorInputMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorComposition","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorText {
            key: 7,
            text: vec![7],
            anchor_offset: 7,
            focus_offset: 7,
            composition_end: true,
            composition_data: "fixture 😀 é".into(),
            selection: sample_selection_msg(),
        };
        let data = bytes(&value).unwrap();
        let decoded = wire::EditorInputMsg::deserialize(&data).unwrap();
        assert_eq!(value, decoded);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorText","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorKeyDown {
            code: 8,
            mods: 4,
            key: "Backspace".into(),
            command: wire::CommandCode::DeleteWord,
            argument: 0,
            selection: sample_selection_msg(),
            target: sample_modify_target_msg(),
            character_target: sample_modify_target_msg(),
        };
        let data = bytes(&value).unwrap();
        assert_eq!(wire::EditorInputMsg::deserialize(&data).unwrap(), value);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorKeyDown","bytes":data}));
    }
    {
        let value = wire::EditorInputMsg::EditorApplication {
            name: "group-b.node-transform".into(),
            json: "\"heading1\"".into(),
            generation: 3,
            selection: sample_selection_msg(),
            keyboard: false,
            key: "".into(),
            mods: 0,
            code: 0,
        };
        let data = bytes(&value).unwrap();
        assert_eq!(wire::EditorInputMsg::deserialize(&data).unwrap(), value);
        cases.push(serde_json::json!({"name":"EditorInputMsg.EditorApplication","bytes":data}));
    }
    let path = directory.join("messages.json");
    let json = serde_json::to_string_pretty(&cases).unwrap() + "\n";
    if record {
        std::fs::write(&path, &json).unwrap();
    }
    assert_eq!(
        serde_json::to_string(
            &serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(path).unwrap(),)
                .expect("valid ABI fixture JSON"),
        )
        .expect("canonical ABI fixture JSON"),
        serde_json::to_string(&cases).expect("canonical recorded ABI cases"),
        "ABI fixtures stale"
    );
}
