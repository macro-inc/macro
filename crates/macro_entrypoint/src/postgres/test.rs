use super::*;

#[test]
fn names_the_service_and_pool() {
    assert_eq!(
        application_name("document-storage-service", "readonly"),
        "document-storage-service:readonly"
    );
}

#[test]
fn keeps_the_name_within_postgres_limit() {
    let name = application_name(&"é".repeat(40), "primary");
    assert!(name.len() <= 63);
    assert!(name.starts_with('é'));
}

#[test]
fn url_application_name_wins() {
    let options = pg_connect_options(
        "postgres://u:p@localhost/db?application_name=explicit",
        "primary",
    )
    .unwrap();
    assert_eq!(options.get_application_name(), Some("explicit"));
}
