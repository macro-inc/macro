use super::*;
use code_execution::domain::Outcome;
use serde_json::json;
use std::sync::Mutex;

#[derive(Default)]
struct Credentials(Mutex<Vec<String>>);
#[async_trait]
impl UserExecutionCredentials for Credentials {
    async fn issue(&self, user: &MacroUserIdStr<'static>) -> Result<RunEnvironment, CodeModeError> {
        self.0.lock().unwrap().push(user.to_string());
        Ok(RunEnvironment {
            token: "run-only-secret".into(),
            ..Default::default()
        })
    }
}

struct Returns(Value);
#[async_trait]
impl ProgramExecutor for Returns {
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
    let service =
        UserCodeModeService::new(Arc::new(Returns(json!({"data": 42}))), credentials.clone());

    let receipt = service
        .execute(&user(), request(), CancellationToken::new())
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
        ["macro|fixture@example.com"]
    );
}

#[tokio::test]
async fn review_references_fail_outside_a_session() {
    let service = UserCodeModeService::new(
        Arc::new(Returns(
            json!({"data": 1, "reviews": [{"kind": "email", "id": "x"}]}),
        )),
        Arc::new(Credentials::default()),
    );

    let receipt = service
        .execute(&user(), request(), CancellationToken::new())
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Failed);
    assert!(receipt.error.unwrap().contains("reviews are unavailable"));
}

#[tokio::test]
async fn a_view_fails_outside_a_session() {
    // Only a session has a conversation to show a view in.
    let service = UserCodeModeService::new(
        Arc::new(Returns(json!({"data": 1, "view": {"widgets": []}}))),
        Arc::new(Credentials::default()),
    );

    let receipt = service
        .execute(&user(), request(), CancellationToken::new())
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Failed);
    assert!(
        receipt
            .error
            .unwrap()
            .contains("views and reviews are unavailable")
    );
}

#[tokio::test]
async fn invalid_requests_are_rejected_before_minting_a_credential() {
    let credentials = Arc::new(Credentials::default());
    let service =
        UserCodeModeService::new(Arc::new(Returns(json!({"data": 1}))), credentials.clone());

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
                .execute(&user(), request, CancellationToken::new())
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
    );

    let receipt = service
        .execute(&user(), request(), CancellationToken::new())
        .await
        .unwrap();

    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    assert_eq!(receipt.result, Some(json!({"data": 1})));
}
