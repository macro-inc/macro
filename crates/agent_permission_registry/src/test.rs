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
