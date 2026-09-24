use super::*;
use crate::api::stream::chat_message::test::{ACTING_USER, RejectAdmission};
use ai_billing::DenyReason;
use ai_usage::AiFeature;

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
async fn blocked_optional_rename_keeps_title_without_failing_chat() {
    // No live database or provider is available; a blocked optional rename must
    // return success before generating, updating the title, or notifying clients.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
        .unwrap();
    pool.close().await;
    let mut ctx = (*crate::api::context::test_api_context(pool).await).clone();
    for reason in [Some(DenyReason::AllowanceExhausted), None] {
        let admission = RejectAdmission::new(reason);
        ctx.tool_service_context.admission = admission.clone();
        rename_initial_chat(
            Arc::new(ctx.clone()),
            MacroUserIdStr::parse_from_str(ACTING_USER).unwrap(),
            uuid::Uuid::now_v7().to_string(),
            uuid::Uuid::now_v7().to_string(),
            "Plan Q3 hiring".to_string(),
        )
        .await
        .unwrap();
        assert_eq!(
            *admission.calls.lock().unwrap(),
            vec![(ACTING_USER.to_string(), AiFeature::ChatRename)]
        );
    }
}
