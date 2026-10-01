use super::*;
use crate::api::context::test::{
    ADMISSION_TEST_USER, TestAdmission, admission_errors, test_api_context,
};

#[test]
fn clean_chat_name_trims_quotes_and_collapses_whitespace() {
    assert_eq!(
        clean_chat_name("  \"Plan   Q3\nHiring\"  "),
        "Plan Q3 Hiring"
    );
}

#[test]
fn clean_chat_name_limits_length() {
    let raw = "a".repeat(120);
    assert_eq!(clean_chat_name(&raw).len(), 100);
}

#[tokio::test]
async fn rejected_rename_succeeds_without_provider_or_persistence_work() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
        .unwrap();
    pool.close().await;
    let ctx = test_api_context(pool).await;
    for error in admission_errors() {
        let admission = TestAdmission::rejecting(error);
        let mut state = (*ctx).clone();
        state.ai_admission = admission.clone();
        // No provider is configured and the pool is closed. Returning Ok proves
        // rejection neither tries a fallback completion nor patches the name.
        rename_initial_chat(
            Arc::new(state),
            MacroUserIdStr::parse_from_str(ADMISSION_TEST_USER).unwrap(),
            uuid::Uuid::now_v7().to_string(),
            "stream-id".into(),
            "Plan Q3 hiring".into(),
        )
        .await
        .unwrap();
        assert_eq!(
            *admission.calls.lock().unwrap(),
            vec![(ADMISSION_TEST_USER.into(), ai_usage::AiFeature::ChatRename)]
        );
    }
}
