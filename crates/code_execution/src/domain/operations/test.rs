use super::*;

#[test]
fn sdk_members_lists_a_namespaces_public_members() {
    let members = sdk_members("SearchNamespace").unwrap();
    assert!(
        members.contains(&"page") && members.contains(&"all"),
        "{members:?}"
    );
    assert!(!members.contains(&"client") && !members.contains(&"request"));
    let suggestion = sdk_members("Suggestion").unwrap();
    assert!(suggestion.contains(&"title") && suggestion.contains(&"rewrite"));
    assert_eq!(sdk_members("NoSuchType"), None);
    // Inherited members come after the type's own.
    let task = sdk_members("Task").unwrap();
    let document = sdk_members("Document").unwrap();
    assert!(
        document.iter().all(|member| task.contains(member)),
        "{task:?}"
    );
}

#[test]
fn sdk_string_literals_lists_a_string_union_aliases_values() {
    // The SDK's own `SearchType`, not the generated harness type of that name.
    assert_eq!(
        sdk_string_literals("SearchType").unwrap(),
        vec![
            "document",
            "email",
            "channel",
            "project",
            "call",
            "calendar_event",
            "agent_session",
            "chat",
            "company"
        ]
    );
    assert_eq!(
        sdk_string_literals("SortDirection").unwrap(),
        vec!["ascending", "descending"]
    );
    assert_eq!(sdk_string_literals("SearchNamespace"), None);
    assert_eq!(sdk_string_literals("NoSuchType"), None);
}
