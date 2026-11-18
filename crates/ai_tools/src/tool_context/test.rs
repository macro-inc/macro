use super::{imported_entity_type, refuses_view};
use entity_access::domain::models::AccessError;
use import::domain::models::ImportSource;
use model_entity::EntityType;

#[test]
fn imports_are_checked_as_the_entity_type_their_source_becomes() {
    assert_eq!(
        imported_entity_type(ImportSource::Linear),
        EntityType::Document
    );
    assert_eq!(
        imported_entity_type(ImportSource::Jira),
        EntityType::Document
    );
    assert_eq!(
        imported_entity_type(ImportSource::Notion),
        EntityType::Document
    );
    assert_eq!(
        imported_entity_type(ImportSource::Slack),
        EntityType::Channel
    );
}

#[test]
fn an_entity_the_caller_cannot_see_is_refused() {
    assert!(refuses_view(&AccessError::Unauthorized));
    assert!(refuses_view(&AccessError::UnauthorizedWithMessage("no")));
    assert!(refuses_view(&AccessError::NotFound("document")));
    assert!(refuses_view(&AccessError::BadRequest("bad id")));
}

#[test]
fn a_failed_access_check_is_an_error_not_a_refusal() {
    assert!(!refuses_view(&AccessError::Unavailable(
        rootcause::report!("database unavailable")
    )));
    assert!(!refuses_view(&AccessError::Internal(rootcause::report!(
        "database failed"
    ))));
}
