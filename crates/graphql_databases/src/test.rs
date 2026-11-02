use super::*;

#[test]
fn repository_failures_are_internal_and_do_not_expose_details() {
    let error =
        graphql_error(DatabaseError::Repo(rootcause::report!("private connection details")).into());
    assert_eq!(error.message, "The database view could not be read.");
    assert_eq!(
        error.extensions.unwrap().get("code"),
        Some(&async_graphql::Value::from("INTERNAL_SERVER_ERROR"))
    );
    let missing = graphql_error(DatabaseError::NotFound.into());
    assert_eq!(missing.message, "not found");
    assert_eq!(
        missing.extensions.unwrap().get("code"),
        Some(&async_graphql::Value::from("NOT_FOUND"))
    );
}
