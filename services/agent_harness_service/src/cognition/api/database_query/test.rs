use super::*;
use crate::cognition::api::context::test::{
    TestAdmission, admission_errors, authorized_request, test_api_context,
};
use axum::{Router, routing::post};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use tower::ServiceExt;

#[test]
fn question_agents_can_only_discover_schemas() {
    let tools = discovery_tools();
    let mut names: Vec<_> = tools.tools.keys().map(String::as_str).collect();
    names.sort();
    assert_eq!(names, ["DescribeDatabase", "ListDatabases"]);
    assert!(tools.user_tools.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_rejects_before_database_discovery_or_model_calls(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool).await;
    for error in admission_errors() {
        let mut state = (*ctx).clone();
        let admission = TestAdmission::rejecting(error);
        state.ai_admission = admission.clone();
        let router = Router::new()
            .route("/database-query", post(generate_database_query))
            .with_state(state);
        let response = router
            .oneshot(authorized_request(
                "/database-query",
                json!({
                    "model": chat::domain::models::FREE_MODEL, "prompt": "Count books",
                    "sql": "", "schema": {"name": "Automatic", "tables": []}
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), admission_status(error));
        assert_eq!(admission.calls.lock().unwrap().len(), 1);
    }
}
