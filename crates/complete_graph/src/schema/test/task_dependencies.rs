use super::*;

#[tokio::test]
async fn ordinary_documents_do_not_invoke_task_dependency_edges() {
    let harness = harness();
    let document = Uuid::from_u128(8);
    harness
        .primary_soup_service
        .set_raw_response(vec![soup_document(document)]);
    // No dependency loader is installed: either unguarded edge fails this request.
    let response = harness.execute(&format!(
        r#"{{ user {{ soupEntity(input: {{entityType: DOCUMENT, entityId: "{document}"}}) {{ ... on GraphqlSoupDocument {{ taskDependencies {{ id }} dependentTasks {{ id }} }} }} }} }}"#
    )).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["user"]["soupEntity"]["taskDependencies"],
        serde_json::Value::Null
    );
    assert_eq!(
        data["user"]["soupEntity"]["dependentTasks"],
        serde_json::json!([])
    );
}
