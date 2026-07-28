use super::changed_project_ids;

#[test]
fn changed_project_ids_include_old_and_new_projects() {
    assert_eq!(
        changed_project_ids(Some("old-project"), Some("new-project")),
        vec!["old-project", "new-project"]
    );
}

#[test]
fn changed_project_ids_include_only_the_project_for_root_transitions() {
    assert_eq!(
        changed_project_ids(None, Some("new-project")),
        vec!["new-project"]
    );
    assert_eq!(
        changed_project_ids(Some("old-project"), None),
        vec!["old-project"]
    );
}

#[test]
fn changed_project_ids_are_empty_for_unchanged_assignments() {
    assert!(changed_project_ids(None, None).is_empty());
    assert!(changed_project_ids(Some("project"), Some("project")).is_empty());
}

#[test]
fn changed_project_ids_ignore_empty_and_duplicate_ids() {
    assert!(changed_project_ids(Some(""), None).is_empty());
    assert!(changed_project_ids(Some("project"), Some("project")).is_empty());
}
