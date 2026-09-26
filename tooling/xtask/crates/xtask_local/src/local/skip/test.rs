use super::*;

fn services() -> BTreeMap<String, Vec<String>> {
    let compose: Value = serde_yaml::from_str(
        r#"
services:
  build_helper:
    profiles: [build-helper]
  document_storage_service:
    depends_on:
      - sync_service
  sync_service: {}
  notification_service:
    depends_on:
      document_cognition_service:
        condition: service_started
  document_cognition_service: {}
  calendar_service: {}
"#,
    )
    .unwrap();
    default_services(&compose)
}

fn skip(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn services_with_a_profile_are_not_skippable() {
    let error = check(&services(), &skip(&["build_helper"])).unwrap_err();
    assert!(error.to_string().contains("not a service"), "{error}");
}

#[test]
fn a_service_nothing_depends_on_can_be_skipped() {
    check(&services(), &skip(&["calendar_service"])).unwrap();
}

#[test]
fn a_dependency_of_a_starting_service_cannot_be_skipped() {
    let error = check(&services(), &skip(&["sync_service"])).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("document_storage_service depends on it"),
        "{error}"
    );
}

#[test]
fn map_form_dependencies_count() {
    assert!(check(&services(), &skip(&["document_cognition_service"])).is_err());
    check(
        &services(),
        &skip(&["notification_service", "document_cognition_service"]),
    )
    .unwrap();
}

#[test]
fn only_binaries_no_kept_service_uses_are_left_out() {
    assert_eq!(
        left_out_bins(&skip(&["agent_harness_service", "email_pubsub_workers"])),
        vec!["agent_harness_service", "pubsub_workers"]
    );
    assert!(left_out_bins(&skip(&["static_file_cdn"])).is_empty());
}
