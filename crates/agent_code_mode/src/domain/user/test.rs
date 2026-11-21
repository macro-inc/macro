use super::*;
use code_execution::domain::Outcome;
use serde_json::json;
use std::sync::Mutex;

#[derive(Default)]
struct Credentials(Mutex<Vec<(String, ToolCaller)>>);
#[async_trait]
impl UserExecutionCredentials for Credentials {
    async fn issue(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: &ToolCaller,
        _session: Option<uuid::Uuid>,
    ) -> Result<RunEnvironment, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .push((user.to_string(), caller.clone()));
        Ok(RunEnvironment {
            token: "run-only-secret".into(),
            ..Default::default()
        })
    }
}

struct Returns(Value);
#[async_trait]
impl ProgramExecutor for Returns {
    async fn check_program(
        &self,
        _: &ExecuteRequest,
        _: code_execution::domain::ContextShape,
        _: CancellationToken,
    ) -> Result<(), Outcome> {
        Ok(())
    }
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        _: RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        unreachable!("the service should observe progress")
    }
    async fn execute_program_with_progress(
        &self,
        _: ExecuteRequest,
        environment: RunEnvironment,
        _: CancellationToken,
        progress: tokio::sync::mpsc::Sender<Value>,
    ) -> Outcome {
        assert_eq!(environment.token, "run-only-secret");
        assert_eq!(environment.session_id, None);
        assert_eq!(environment.execution_id, None);
        progress
            .send(json!({"id": 1, "service": "agent-harness", "operation": "getAgentCodingPreferences", "status": "started"}))
            .await
            .unwrap();
        progress
            .send(json!({"id": 1, "service": "agent-harness", "operation": "getAgentCodingPreferences", "status": "completed"}))
            .await
            .unwrap();
        Outcome::Succeeded {
            value: self.0.clone(),
        }
    }
}

/// PNG pixels named after their file, owned by the fixture user; the file
/// `missing` cannot be read.
struct Pixels;
#[async_trait]
impl ModelImages for Pixels {
    async fn load_png(
        &self,
        file: &super::super::StaticFileId,
        owner: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<ModelImage> {
        anyhow::ensure!(file.as_ref() != "missing", "no such file");
        anyhow::ensure!(
            owner.as_ref() == "macro|fixture@example.com",
            "the file belongs to someone else"
        );
        Ok(ModelImage {
            r#type: super::super::ModelMediaType::Image,
            media_type: super::super::ModelImageMediaType::Png,
            data: format!("iVBORw0KGgo{}", file.as_ref()),
        })
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|fixture@example.com").unwrap()
}

fn request() -> ExecuteRequest {
    ExecuteRequest {
        source: "export async function main() { return {data: 42}; }".into(),
        timeout_ms: 30_000,
    }
}

#[tokio::test]
async fn runs_as_the_authenticated_user_and_returns_data_with_activity() {
    let credentials = Arc::new(Credentials::default());
    let service = UserCodeModeService::new(
        Arc::new(Returns(json!({"data": 42}))),
        credentials.clone(),
        Arc::new(Pixels),
    );

    let caller = ToolCaller::Agent(bot_id::BotId::new_from_uuid(macro_uuid::Uuid::from_u128(
        0xA1,
    )));
    let receipt = service
        .execute(&user(), &caller, None, request(), CancellationToken::new())
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    assert_eq!(receipt.result, Some(json!({"data": 42})));
    assert_eq!(receipt.error, None);
    assert_eq!(receipt.activity.len(), 1);
    assert_eq!(receipt.activity[0].label, "Get Agent Coding Preferences");
    assert_eq!(
        receipt.activity[0].status,
        super::super::RecordedCallStatus::Completed
    );
    assert_eq!(
        *credentials.0.lock().unwrap(),
        [("macro|fixture@example.com".to_owned(), caller)]
    );
}

#[tokio::test]
async fn review_references_fail_outside_a_session() {
    let service = UserCodeModeService::new(
        Arc::new(Returns(
            json!({"data": 1, "reviews": [{"kind": "email", "id": "x"}]}),
        )),
        Arc::new(Credentials::default()),
        Arc::new(Pixels),
    );

    let receipt = service
        .execute(
            &user(),
            &ToolCaller::ApiKey,
            None,
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Failed);
    assert!(receipt.error.unwrap().contains("reviews are unavailable"));
}

#[tokio::test]
async fn invalid_requests_are_rejected_before_minting_a_credential() {
    let credentials = Arc::new(Credentials::default());
    let service = UserCodeModeService::new(
        Arc::new(Returns(json!({"data": 1}))),
        credentials.clone(),
        Arc::new(Pixels),
    );

    for request in [
        ExecuteRequest {
            source: " ".into(),
            timeout_ms: 1000,
        },
        ExecuteRequest {
            source: "export async function main() {}".into(),
            timeout_ms: 30_001,
        },
    ] {
        assert!(matches!(
            service
                .execute(
                    &user(),
                    &ToolCaller::ApiKey,
                    None,
                    request,
                    CancellationToken::new()
                )
                .await,
            Err(CodeModeError::Invalid(_))
        ));
    }
    assert!(credentials.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_empty_reviews_list_is_dropped() {
    let service = UserCodeModeService::new(
        Arc::new(Returns(json!({"data": 1, "reviews": []}))),
        Arc::new(Credentials::default()),
        Arc::new(Pixels),
    );

    let receipt = service
        .execute(
            &user(),
            &ToolCaller::ApiKey,
            None,
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    assert_eq!(receipt.result, Some(json!({"data": 1})));
}

#[tokio::test]
async fn a_channel_bot_sees_the_images_its_program_returned() {
    let service = UserCodeModeService::new(
        Arc::new(Returns(json!({
            "data": {"rendered": true},
            "images": [{"id": "render-1", "url": "https://static/file/render-1", "width": 10}],
        }))),
        Arc::new(Credentials::default()),
        Arc::new(Pixels),
    );
    let bot = ToolCaller::Agent(bot_id::BotId::new_from_uuid(macro_uuid::Uuid::from_u128(
        0xB0,
    )));

    let receipt = service
        .execute(
            &user(),
            &bot,
            Some(uuid::Uuid::from_u128(0x5E)),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    assert_eq!(receipt.error, None);
    let json = serde_json::to_value(&receipt).unwrap();
    assert_eq!(
        json["modelMedia"],
        json!([{"type": "image", "mediaType": "image/png", "data": "iVBORw0KGgorender-1"}])
    );
    assert_eq!(json["result"]["images"][0]["id"], "render-1");
}

#[tokio::test]
async fn an_image_that_cannot_be_shown_drops_them_all_and_says_which() {
    let service = UserCodeModeService::new(
        Arc::new(Returns(json!({
            "data": 1,
            "images": [{"id": "render-1"}, {"id": "missing"}],
        }))),
        Arc::new(Credentials::default()),
        Arc::new(Pixels),
    );

    let receipt = service
        .execute(
            &user(),
            &ToolCaller::ApiKey,
            None,
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert!(receipt.model_media.is_empty());
    assert!(
        receipt
            .error
            .as_deref()
            .unwrap()
            .contains("image missing could not be shown")
    );
    assert!(
        serde_json::to_value(&receipt)
            .unwrap()
            .get("modelMedia")
            .is_none()
    );
}

#[tokio::test]
async fn more_than_two_images_fail_the_result() {
    let service = UserCodeModeService::new(
        Arc::new(Returns(json!({
            "data": 1,
            "images": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
        }))),
        Arc::new(Credentials::default()),
        Arc::new(Pixels),
    );

    let receipt = service
        .execute(
            &user(),
            &ToolCaller::ApiKey,
            None,
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Failed);
    assert!(receipt.model_media.is_empty());
    assert!(receipt.error.unwrap().contains("at most 2 SDK images"));
}

#[tokio::test]
async fn an_image_someone_else_owns_is_not_shown() {
    let service = UserCodeModeService::new(
        Arc::new(Returns(json!({"data": 1, "images": [{"id": "render-1"}]}))),
        Arc::new(Credentials::default()),
        Arc::new(Pixels),
    );
    let someone_else = MacroUserIdStr::parse_from_str("macro|someone-else@example.com").unwrap();

    let receipt = service
        .execute(
            &someone_else,
            &ToolCaller::ApiKey,
            None,
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert!(receipt.model_media.is_empty());
    assert!(
        receipt
            .error
            .as_deref()
            .unwrap()
            .contains("image render-1 could not be shown")
    );
}

/// Fails every program at its check, as the checker fails one with type
/// errors; running one is a bug.
struct RejectsTypes;
#[async_trait]
impl ProgramExecutor for RejectsTypes {
    async fn check_program(
        &self,
        _: &ExecuteRequest,
        shape: code_execution::domain::ContextShape,
        _: CancellationToken,
    ) -> Result<(), Outcome> {
        assert_eq!(shape, code_execution::domain::ContextShape::default());
        Err(code_execution::domain::ExecutionFailure::new(
            code_execution::domain::FailureCode::Compile,
            "The program wasn't run: it doesn't type-check against the Macro SDK.",
        )
        .into())
    }
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        _: RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        unreachable!("a program with type errors never runs")
    }
}

#[tokio::test]
async fn a_program_with_type_errors_fails_before_minting_a_credential() {
    let credentials = Arc::new(Credentials::default());
    let service = UserCodeModeService::new(
        Arc::new(RejectsTypes),
        credentials.clone(),
        Arc::new(Pixels),
    );

    let receipt = service
        .execute(
            &user(),
            &ToolCaller::ApiKey,
            None,
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Failed);
    assert!(
        receipt
            .error
            .unwrap()
            .contains("doesn't type-check against the Macro SDK")
    );
    assert!(credentials.0.lock().unwrap().is_empty());
}
