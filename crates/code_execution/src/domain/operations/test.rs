use super::*;

#[test]
fn sdk_members_lists_a_namespaces_public_members() {
    let members = sdk_members("SearchNamespace").unwrap();
    assert!(members.contains(&"page") && members.contains(&"all"), "{members:?}");
    assert!(!members.contains(&"client") && !members.contains(&"request"));
    let suggestion = sdk_members("Suggestion").unwrap();
    assert!(suggestion.contains(&"title") && suggestion.contains(&"rewrite"));
    assert_eq!(sdk_members("NoSuchType"), None);
}
