use super::*;

#[test]
fn invalid_name_length_is_actionable_without_exposing_internal_errors() {
    let error = failure(InitiativeError::NameTooLong { max: 100 });
    assert_eq!(
        error.description,
        "Project names must be at most 100 graphemes long"
    );
    let internal = failure(InitiativeError::Internal(rootcause::report!(
        "private database failure"
    )));
    assert_eq!(internal.description, "The project operation failed");
}
