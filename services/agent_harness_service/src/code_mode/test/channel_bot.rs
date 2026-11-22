use crate::cognition::{ADMISSION_TEST_USER, test_api_context};
use agent_code_mode::domain::{
    CodeModeError, ExecutionStatus, MentionCodeMode, MentionContext, UserExecutionReceipt,
};
use ai_usage::{UsageEvent, UsageRecorder};
use channel_bots::{
    domain::{models::BotMention, ports::AgentResponder},
    outbound::{AgentLoopResponder, code_mode::ChannelBotTools},
};
use code_execution::domain::ExecuteRequest;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use memory::{domain::ports::ComposedMemoryRepo, outbound::pg_memory_repo::PgMemoryRepo};
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct Programs(Mutex<Vec<(String, MentionContext, String)>>);

#[async_trait::async_trait]
impl MentionCodeMode for Programs {
    async fn execute(
        &self,
        user: &MacroUserIdStr<'static>,
        mention: &MentionContext,
        request: ExecuteRequest,
        _: CancellationToken,
    ) -> Result<UserExecutionReceipt, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .push((user.as_ref().to_owned(), mention.clone(), request.source));
        Ok(UserExecutionReceipt {
            status: ExecutionStatus::Succeeded,
            activity: Vec::new(),
            activity_truncated: false,
            result: Some(json!({"data": "found the document"})),
            error: None,
        })
    }
}

struct NoUsage;
impl UsageRecorder for NoUsage {
    fn record(&self, _: UsageEvent) {}
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_responder_runs_code_for_the_original_user_and_mention(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool.clone()).await;
    let programs = Arc::new(Programs::default());
    let source = "export async function main() { return {data: 'found the document'}; }";
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::reasoning("Check the document before replying."),
            MockStreamEvent::tool_call("code-1", "ExecuteCode", json!({"source": source})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("I found the document."),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);
    let responder = AgentLoopResponder::new(
        ctx.tool_service_context.clone(),
        ChannelBotTools::new(programs.clone()),
    )
    .with_agent_loop(
        agent::AgentLoop::new(Arc::new(NoUsage))
            .with_max_turns(3)
            .with_test_model(model),
    );
    let mention = BotMention {
        message_id: uuid::Uuid::from_u128(101),
        root_id: uuid::Uuid::from_u128(202),
    };
    let reply = responder
        .respond(ADMISSION_TEST_USER, mention, "Find my document.".to_owned())
        .await
        .unwrap();
    assert_eq!(reply, "I found the document.");
    // Classic mentions use AgentLoop directly, without the session runtime's
    // automatic memory fetch. Even that hidden read would enroll this user.
    let memory = PgMemoryRepo::new(pool);
    let today = chrono::Utc::now().date_naive();
    assert!(memory.claim_refresh(today).await.unwrap().is_none());
    // The control proves that enrollment would be observable in this fixture.
    memory
        .enroll(&MacroUserIdStr::try_from(ADMISSION_TEST_USER).unwrap())
        .await
        .unwrap();
    assert_eq!(
        memory
            .claim_refresh(today)
            .await
            .unwrap()
            .unwrap()
            .user
            .as_ref(),
        ADMISSION_TEST_USER
    );
    assert_eq!(
        *programs.0.lock().unwrap(),
        vec![(
            ADMISSION_TEST_USER.to_owned(),
            MentionContext {
                message_id: mention.message_id,
                root_id: mention.root_id,
            },
            source.to_owned(),
        )]
    );
}
