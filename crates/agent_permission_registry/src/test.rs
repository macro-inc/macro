use std::collections::{BTreeMap, BTreeSet};

use super::{Action, group, groups, operation, operations};

#[test]
fn group_ids_are_unique() {
    let ids: BTreeSet<&str> = groups().iter().map(|group| group.id.as_str()).collect();
    assert_eq!(ids.len(), groups().len());
}

#[test]
fn every_operation_names_a_group_and_every_group_has_operations() {
    let mut per_group: BTreeMap<&str, usize> = BTreeMap::new();
    for (service, operation_id, operation) in operations() {
        assert!(
            group(&operation.group).is_some(),
            "{service}.{operation_id} names the unknown group {}",
            operation.group
        );
        *per_group.entry(operation.group.as_str()).or_default() += 1;
    }

    for group in groups() {
        assert!(
            per_group.contains_key(group.id.as_str()),
            "group {} has no operations",
            group.id
        );
        assert!(
            !group.name.is_empty() && !group.description.is_empty(),
            "group {} needs a name and description",
            group.id
        );
    }
}

/// A group's custom view lists its operations by label, so two with one
/// label would be indistinguishable there.
#[test]
fn labels_are_set_and_unique_within_a_group() {
    let mut seen: BTreeMap<(&str, &str), String> = BTreeMap::new();
    for (service, operation_id, operation) in operations() {
        assert!(
            !operation.label.trim().is_empty(),
            "{service}.{operation_id} has no label"
        );
        if let Some(other) = seen.insert(
            (operation.group.as_str(), operation.label.as_str()),
            format!("{service}.{operation_id}"),
        ) {
            panic!(
                "{other} and {service}.{operation_id} share the label {:?}",
                operation.label
            );
        }
    }
}

#[test]
fn looks_up_by_service_and_operation_id() {
    let send = operation("email", "send_message").expect("email.send_message is classified");
    assert_eq!(send.group, "email");
    assert_eq!(send.action, Action::Send);
    assert_eq!(send.label, "Send email");

    assert!(operation("email", "no_such_operation").is_none());
    assert!(operation("no-such-service", "send_message").is_none());
}

#[test]
fn an_action_parses_from_its_stored_name() {
    for action in Action::ALL {
        assert_eq!(Action::parse(action.as_str()), Some(action));
    }
    assert_eq!(Action::parse("delete"), None);
}

#[test]
fn every_action_is_shown_once_read_first_and_delete_last() {
    let mut shown = Action::DISPLAY.to_vec();
    assert_eq!(
        shown,
        [
            Action::Read,
            Action::Create,
            Action::Update,
            Action::Send,
            Action::Destroy
        ]
    );
    shown.sort();
    assert_eq!(shown, Action::ALL);
}

#[test]
fn the_version_is_twelve_hex_characters() {
    let version = super::version();
    assert_eq!(version.len(), 12);
    assert!(version.chars().all(|c| c.is_ascii_hexdigit()));
}

/// Always allowed is the exception, for what can only restrict the agent:
/// widening it is a decision, so the list is pinned here.
#[test]
fn only_self_restriction_is_always_allowed() {
    let always: Vec<String> = operations()
        .filter(|(_, _, operation)| operation.always_allowed)
        .map(|(service, operation_id, _)| format!("{service}.{operation_id}"))
        .collect();
    assert_eq!(always, ["agent-harness.tighten_agent_tool_permissions"]);
}

/// Channel administration left `channels` for `channel_admin`, each operation
/// keeping the action it had there. A migration copied every saved
/// `channels:<action>` rule to `channel_admin:<action>`, so a moved
/// operation resolves exactly as before only while its action is unchanged:
/// this table is the operations and actions they had in `channels`.
#[test]
fn channel_admin_moves_keep_every_operations_action() {
    const MOVED: [(&str, Action); 16] = [
        ("add_channel_bot", Action::Send),
        ("add_participants", Action::Send),
        ("cancel_channel_access_request", Action::Update),
        ("create_channel", Action::Send),
        ("delete_channel", Action::Destroy),
        ("get_channel_access_request", Action::Read),
        ("get_channel_join_link", Action::Read),
        ("get_my_channel_access_request", Action::Read),
        ("join_channel", Action::Send),
        ("leave_channel", Action::Send),
        ("list_channel_bots", Action::Read),
        ("patch_channel", Action::Send),
        ("remove_participants", Action::Send),
        ("request_channel_access", Action::Send),
        ("resolve_channel_access_request", Action::Send),
        ("set_channel_picture", Action::Send),
    ];

    for (operation_id, action) in MOVED {
        let moved = operation("storage", operation_id)
            .unwrap_or_else(|| panic!("storage.{operation_id} is classified"));
        assert_eq!(moved.group, "channel_admin", "storage.{operation_id}");
        assert_eq!(
            moved.action, action,
            "storage.{operation_id} kept its action"
        );
    }

    let in_channel_admin: BTreeSet<String> = operations()
        .filter(|(_, _, operation)| operation.group == "channel_admin")
        .map(|(service, operation_id, _)| format!("{service}.{operation_id}"))
        .collect();
    let pinned: BTreeSet<String> = MOVED
        .iter()
        .map(|(operation_id, _)| format!("storage.{operation_id}"))
        .collect();
    assert_eq!(
        in_channel_admin, pinned,
        "an operation joining channel_admin later needs no copied rule; add it here"
    );

    let ids: Vec<&str> = groups().iter().map(|group| group.id.as_str()).collect();
    let channels = ids.iter().position(|id| *id == "channels");
    assert_eq!(
        ids.iter().position(|id| *id == "channel_admin"),
        channels.map(|at| at + 1),
        "channel_admin is listed right after channels"
    );
}

/// Messaging stays in `channels`: these send something people read.
#[test]
fn channel_messaging_stays_in_channels() {
    for operation_id in [
        "create_entity_mention",
        "entity_message_create",
        "entity_message_edit",
        "entity_message_patch_thread",
        "entity_message_react",
        "entity_message_typing",
        "post_activity",
        "post_channel_bot_webhook",
    ] {
        let kept = operation("storage", operation_id)
            .unwrap_or_else(|| panic!("storage.{operation_id} is classified"));
        assert_eq!(kept.group, "channels", "storage.{operation_id}");
        assert_eq!(kept.action, Action::Send, "storage.{operation_id}");
    }
}
