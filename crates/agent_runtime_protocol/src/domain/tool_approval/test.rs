use agent_client_protocol::RawJsonRpcMessage;

use super::*;

fn notice(status: ToolApprovalStatus) -> ToolApprovalNotice {
    ToolApprovalNotice {
        approval_id: "0192f7a0-0000-7000-8000-000000000001".to_owned(),
        server_slug: "macro".to_owned(),
        server_name: "Macro".to_owned(),
        tool_name: "ListEmails".to_owned(),
        arguments: serde_json::json!({ "limit": 5 }),
        requested_by: Some("macro|julia@macro.com".to_owned()),
        status,
        resolved_by: None,
    }
}

#[test]
fn a_notice_round_trips_through_its_logged_frame() {
    let original = notice(ToolApprovalStatus::Pending);
    let ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::Notification(frame))) =
        original.to_server_message()
    else {
        panic!("a notice is logged as a notification");
    };
    assert_eq!(&*frame.method, TOOL_APPROVAL_METHOD);
    assert_eq!(
        ToolApprovalNotice::from_notification(&frame.method, frame.params.as_ref()),
        Some(original)
    );
}

#[test]
fn the_wire_shape_is_camel_case_with_snake_case_statuses() {
    let value = serde_json::to_value(notice(ToolApprovalStatus::Expired)).unwrap();
    assert_eq!(value["approvalId"], "0192f7a0-0000-7000-8000-000000000001");
    assert_eq!(value["toolName"], "ListEmails");
    assert_eq!(value["status"], "expired");
    assert!(value.get("resolvedBy").is_none());
}

#[test]
fn other_methods_are_not_notices() {
    assert_eq!(
        ToolApprovalNotice::from_notification("session/update", None),
        None
    );
}

#[test]
fn statuses_parse_their_own_spelling() {
    for status in [
        ToolApprovalStatus::Pending,
        ToolApprovalStatus::Approved,
        ToolApprovalStatus::Denied,
        ToolApprovalStatus::Cancelled,
        ToolApprovalStatus::Expired,
    ] {
        assert_eq!(ToolApprovalStatus::parse(status.as_str()), Some(status));
    }
    assert_eq!(ToolApprovalStatus::parse("maybe"), None);
}
