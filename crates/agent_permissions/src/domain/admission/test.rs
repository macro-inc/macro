use agent_permission_registry::Action;

use super::*;
use crate::domain::model::{CatalogEntry, ExecutionPermission, Origin};

fn resolved(operation: &str, state: PermissionState, known: bool) -> ResolvedCall {
    ResolvedCall {
        key: OperationKey {
            service: "storage".into(),
            operation: operation.into(),
        },
        entry: known.then(|| CatalogEntry {
            service: "storage".into(),
            operation: operation.into(),
            group: "documents".into(),
            action: Action::Destroy,
            label: "Delete a document".into(),
        }),
        state,
        origin: if known {
            Origin::GroupAction
        } else {
            Origin::Default
        },
    }
}

#[test]
fn calls_sort_by_state_with_their_group_names() {
    let admission = sort(vec![
        resolved("delete_document", PermissionState::Never, true),
        resolved("create_task_handler", PermissionState::Ask, true),
        resolved("get_document_markdown", PermissionState::Always, true),
    ]);
    assert_eq!(admission.blocked.len(), 1);
    assert_eq!(admission.ask.len(), 1);
    assert_eq!(admission.allowed.len(), 1);
    let blocked = &admission.blocked[0];
    assert_eq!(blocked.group, "documents");
    assert_eq!(
        blocked.group_name,
        agent_permission_registry::group("documents").unwrap().name
    );
    assert_eq!(blocked.action, Some(Action::Destroy));
    assert_eq!(blocked.origin, Origin::GroupAction);
}

#[test]
fn an_unclassified_operation_is_blocked_and_named_by_its_key() {
    let admission = sort(vec![resolved("brand_new", PermissionState::Never, false)]);
    let blocked = &admission.blocked[0];
    assert_eq!(blocked.label, "storage.brand_new");
    assert_eq!(blocked.group, "unclassified");
    assert_eq!(blocked.action, None);
}

#[test]
fn a_permission_outcome_serializes_for_the_web() {
    let operation = sort(vec![resolved(
        "delete_document",
        PermissionState::Never,
        true,
    )])
    .blocked
    .remove(0);
    assert_eq!(
        serde_json::to_value(ExecutionPermission::Blocked {
            operations: vec![operation],
        })
        .unwrap(),
        serde_json::json!({
            "outcome": "blocked",
            "operations": [{
                "service": "storage",
                "operation": "delete_document",
                "label": "Delete a document",
                "group": "documents",
                "groupName": agent_permission_registry::group("documents").unwrap().name,
                "action": "destroy",
                "state": "never",
                "origin": "group_action",
            }],
        })
    );
}
