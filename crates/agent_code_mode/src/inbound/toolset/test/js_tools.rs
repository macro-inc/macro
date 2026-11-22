//! The JavaScript tools `ExecuteCode` end to end below the MCP adapter: the
//! tool call, [`CodeModeService`](crate::domain::CodeModeService), the
//! credential issuer where the permission gate sits, and the real Deno
//! runtime, against a stub of the storage service. The real-runtime tests
//! need Deno 2.9.6 on `PATH`.

use super::*;
use crate::domain::{
    CodeModeKinds, CodeModeService, ExecutionCredentials, ExecutionIdentity, ExecutionPermission,
    ExecutionRecord, ExecutionStatus, ExecutionStore, ExecutionTurns, IssuedRun, JsToolsPrograms,
    ModelImage, ModelImages, NotRun, OwnerRollout, ProgramLanguage, StaticFileId,
};
use agent_session::domain::model::AgentSessionId;
use ai_toolset::ToolSet as _;
use code_execution::domain::{
    ExecutionService, Limits, RunEnvironment, SdkCall, SdkEndpoints, SdkOperation,
};
use std::collections::BTreeMap;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Default)]
struct Store(Mutex<Vec<ExecutionRecord>>);

#[async_trait]
impl ExecutionStore for Store {
    async fn create(
        &self,
        _: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        self.0.lock().unwrap().push(record.clone());
        Ok(())
    }
    async fn save(&self, _: AgentSessionId, record: &ExecutionRecord) -> Result<(), CodeModeError> {
        let mut records = self.0.lock().unwrap();
        records.retain(|saved| saved.execution_id != record.execution_id);
        records.push(record.clone());
        Ok(())
    }
    async fn get(
        &self,
        _: AgentSessionId,
        id: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .find(|record| record.execution_id == id)
            .cloned()
            .ok_or(CodeModeError::NotFound)
    }
}

struct Turn;
#[async_trait]
impl ExecutionTurns for Turn {
    async fn active(&self, _: AgentSessionId) -> Result<Option<macro_uuid::Uuid>, CodeModeError> {
        Ok(Some(macro_uuid::Uuid::from_u128(1)))
    }
}

/// JS tools programs aren't type-checked; nothing here reaches a checker.
struct Unchecked;
#[async_trait]
impl code_execution::domain::ProgramChecker for Unchecked {
    fn sdk_fingerprint(&self) -> &str {
        "unchecked"
    }
    async fn check_files(
        &self,
        _: &[code_execution::domain::SourceFile],
        _: &str,
        _: code_execution::domain::ProgramImports,
    ) -> Result<Vec<code_execution::domain::Diagnostic>, code_execution::domain::CheckError> {
        Ok(Vec::new())
    }
}

/// No program here returns images.
struct NoImages;
#[async_trait]
impl ModelImages for NoImages {
    async fn load_png(
        &self,
        _: &StaticFileId,
        _: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<ModelImage> {
        anyhow::bail!("no images")
    }
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    loop {
        let mut buffer = [0; 4096];
        let count = stream.read(&mut buffer).await.unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
            let length = headers
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .map(|value| value.trim().parse::<usize>().unwrap())
                .unwrap_or_default();
            if bytes.len() >= end + 4 + length {
                return String::from_utf8(bytes).unwrap();
            }
        }
    }
}

/// What the permission gate in the credential issuer answers.
#[derive(Clone)]
enum Gate {
    /// Admitted, limited to these operations.
    Admit(Vec<SdkCall>),
    /// Checked and refused.
    Refuse,
}

/// The credential issuer, with a stand-in for the harness's permission
/// gate: it records the language of each program it is asked about.
struct Credentials {
    storage: String,
    gate: Gate,
    asked: Mutex<Vec<ProgramLanguage>>,
}

#[async_trait]
impl ExecutionCredentials for Credentials {
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        _: &str,
        language: ProgramLanguage,
        _: CancellationToken,
    ) -> Result<IssuedRun, CodeModeError> {
        self.asked.lock().unwrap().push(language);
        let allowed_operations = match &self.gate {
            Gate::Admit(calls) => Some(calls.clone()),
            Gate::Refuse => {
                return Err(CodeModeError::NotRun(NotRun {
                    message: "This program did not run: this agent is not allowed to create tasks."
                        .into(),
                    permission: Some(ExecutionPermission::Blocked {
                        operations: Vec::new(),
                    }),
                }));
            }
        };
        Ok(IssuedRun {
            environment: RunEnvironment {
                token: "fixture-run-token".into(),
                endpoints: SdkEndpoints {
                    hosts: BTreeMap::from([("storage".into(), self.storage.clone())]),
                    web_app_url: "https://app.example.test".into(),
                },
                session_id: Some(identity.session.as_uuid()),
                execution_id: Some(identity.execution.as_uuid()),
                allowed_operations,
                ..Default::default()
            },
            acting_user: identity.owner.clone(),
        })
    }
}

struct Rollout(bool);
#[async_trait]
impl OwnerRollout for Rollout {
    async fn enabled(&self, _: &MacroUserIdStr<'static>) -> bool {
        self.0
    }
}

fn call(operation_id: &str, method: &str, route: &str) -> SdkCall {
    SdkCall {
        operation: SdkOperation {
            service: "storage".into(),
            operation_id: operation_id.into(),
        },
        method: method.into(),
        route: route.into(),
        rivals: Vec::new(),
    }
}

/// What the gate finds in the example: both its operations.
fn example_calls() -> Vec<SdkCall> {
    vec![
        call("create_task_handler", "POST", "/documents/create_task"),
        call("get_document_markdown", "GET", "/documents/{}/markdown"),
    ]
}

/// The JavaScript tools example in ExecuteCode's description.
fn example() -> &'static str {
    let text = include_str!("../session/js_tools.md");
    let start = text.find("```js\n").unwrap() + "```js\n".len();
    let end = start + text[start..].find("```").unwrap();
    &text[start..end]
}

/// A stub storage service answering the example's two requests, returning
/// the requests it got.
async fn storage() -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        while let Ok((mut stream, _)) = listener.accept().await {
            let request = read_request(&mut stream).await;
            let body = if request.starts_with("POST /documents/create_task ") {
                r#"{"documentId":"task-1","documentMetadata":{"documentId":"task-1","documentName":"Fix login redirect loop","documentVersionId":1,"owner":"macro|fixture@example.com"},"initialSnapshot":"","token":"t"}"#
            } else {
                r#"{"markdown":"Signing in from a deep link returns to the login page.","revision":"r1"}"#
            };
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            requests.push(request);
            if requests.len() == 2 {
                break;
            }
        }
        requests
    });
    (format!("http://{address}"), server)
}

/// Code mode on the real Deno runtime, with JS tools on or off for the
/// owner, and the credential issuer it uses.
async fn service(
    storage: String,
    gate: Gate,
    rollout: bool,
) -> (CodeModeService, Arc<Credentials>, Arc<Store>) {
    let deno = tokio::process::Command::new("which")
        .arg("deno")
        .output()
        .await
        .unwrap();
    assert!(deno.status.success(), "Deno 2.9.6 must be on PATH");
    let scratch = tempfile::tempdir().unwrap().keep();
    let runner = code_execution::outbound::deno::DenoRunner::new(
        String::from_utf8(deno.stdout).unwrap().trim().into(),
        scratch,
        128,
    )
    .await
    .unwrap();
    let credentials = Arc::new(Credentials {
        storage,
        gate,
        asked: Mutex::default(),
    });
    let store = Arc::new(Store::default());
    let service = CodeModeService::new(
        Some(Arc::new(
            ExecutionService::new(Arc::new(runner), Arc::new(Unchecked), Limits::default())
                .unwrap(),
        )),
        credentials.clone(),
        store.clone(),
        Arc::new(Turn),
        Arc::new(NoImages),
    )
    .with_js_tools(JsToolsPrograms {
        fingerprint: code_mode_assets::JS_TOOLS_FINGERPRINT.into(),
        rollout: Arc::new(Rollout(rollout)),
    });
    (service, credentials, store)
}

/// Call ExecuteCode as the session's tools offer it: the receipt, or why the
/// call was refused.
async fn execute(service: CodeModeService, source: &str) -> Result<serde_json::Value, String> {
    let session = agent_session::testing::test_agent_session(AgentSessionId::new());
    let kind = service
        .code_mode_kind(session.id, session.owner_user().unwrap())
        .await;
    let tools = session_toolset(kind);
    tools
        .try_tool_call(
            CodeModeToolContext {
                service: Arc::new(service),
                session,
                cognition: None,
                kind,
            },
            RequestContext::new(user()),
            "ExecuteCode",
            &serde_json::json!({
                "acting_as": "requester",
                "turn_id": "00000000-0000-0000-0000-000000000001",
                "language": "js_tools",
                "source": source,
            }),
        )
        .await
        .map_err(|error| format!("{error:?}"))?
        .map_err(|error| error.description)
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn js_tools_tool_example_reaches_the_gate_and_creates_and_reads_a_task() {
    let (storage, server) = storage().await;
    let (service, credentials, store) = service(storage, Gate::Admit(example_calls()), true).await;
    let receipt = execute(service, example()).await.unwrap();
    assert_eq!(receipt["status"], "succeeded", "{receipt}");
    assert_eq!(
        receipt["result"]["data"],
        serde_json::json!({
            "taskId": "task-1",
            "markdown": "Signing in from a deep link returns to the login page.",
        })
    );
    // The session shows each SDK call, as for a JavaScript run.
    let activity = receipt["activity"].as_array().unwrap();
    assert_eq!(activity.len(), 2, "{receipt}");
    assert!(activity.iter().all(|item| item["status"] == "completed"));
    assert_eq!(
        *credentials.asked.lock().unwrap(),
        [ProgramLanguage::JsTools]
    );

    let requests = server.await.unwrap();
    assert!(requests[0].starts_with("POST /documents/create_task "));
    assert!(requests[1].starts_with("GET /documents/task-1/markdown "));
    for request in &requests {
        let lower = request.to_lowercase();
        assert!(lower.contains("authorization: bearer fixture-run-token"));
        assert!(lower.contains("x-macro-code-execution: js_tools"));
    }

    let record = store.0.lock().unwrap()[0].clone();
    assert_eq!(record.status, ExecutionStatus::Succeeded);
    assert_eq!(record.language, ProgramLanguage::JsTools);
    assert_eq!(
        record.sdk_fingerprint.as_deref(),
        Some(code_mode_assets::JS_TOOLS_FINGERPRINT)
    );
    assert_eq!(record.source, example());
    // The saved record names its language and fingerprint.
    let saved = serde_json::to_value(&record).unwrap();
    assert_eq!(saved["language"], "js_tools");
    assert_eq!(
        saved["sdkFingerprint"],
        code_mode_assets::JS_TOOLS_FINGERPRINT
    );
}

/// A program the gate refuses never runs: the receipt says why, and the
/// record keeps the language.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_js_tools_program_the_gate_refuses_does_not_run() {
    let (storage, server) = storage().await;
    let (service, credentials, store) = service(storage, Gate::Refuse, true).await;
    let receipt = execute(service, example()).await.unwrap();
    assert_eq!(receipt["status"], "failed", "{receipt}");
    assert_eq!(receipt["permission"]["outcome"], "blocked", "{receipt}");
    assert!(
        receipt["error"]
            .as_str()
            .unwrap()
            .contains("not allowed to create tasks")
    );
    assert_eq!(
        *credentials.asked.lock().unwrap(),
        [ProgramLanguage::JsTools]
    );
    let record = store.0.lock().unwrap()[0].clone();
    assert_eq!(record.status, ExecutionStatus::Failed);
    assert_eq!(record.language, ProgramLanguage::JsTools);
    server.abort();
}

/// A program that may call more than the gate admitted, or that can't be
/// analyzed, fails before it sends anything.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_js_tools_program_outside_what_was_checked_sends_nothing() {
    for (source, expected) in [
        // The gate admitted only the read.
        (example(), "create_task_handler"),
        (
            "const t = tools; return await t.storage.get_document_markdown({})",
            "main.js:1:",
        ),
    ] {
        let (storage, server) = storage().await;
        let (service, _, _) = service(
            storage,
            Gate::Admit(vec![call(
                "get_document_markdown",
                "GET",
                "/documents/{}/markdown",
            )]),
            true,
        )
        .await;
        let receipt = execute(service, source).await.unwrap();
        assert_eq!(receipt["status"], "failed", "{receipt}");
        assert!(
            receipt["error"].as_str().unwrap().contains(expected),
            "{receipt}"
        );
        assert!(receipt["activity"].as_array().unwrap().is_empty());
        assert!(!server.is_finished());
        server.abort();
    }
}

/// Without the rollout, the tool takes no JS tools program, and code mode
/// refuses one before asking for a credential.
#[tokio::test]
async fn js_tools_without_the_rollout_is_refused_before_a_credential() {
    let credentials = Arc::new(Credentials {
        storage: "http://127.0.0.1:9".into(),
        gate: Gate::Admit(example_calls()),
        asked: Mutex::default(),
    });
    let service = CodeModeService::new(
        Some(Arc::new(
            ExecutionService::new(Arc::new(Never), Arc::new(Unchecked), Limits::default()).unwrap(),
        )),
        credentials.clone(),
        Arc::new(Store::default()),
        Arc::new(Turn),
        Arc::new(NoImages),
    )
    .with_js_tools(JsToolsPrograms {
        fingerprint: code_mode_assets::JS_TOOLS_FINGERPRINT.into(),
        rollout: Arc::new(Rollout(false)),
    });
    let session = agent_session::testing::test_agent_session(AgentSessionId::new());
    assert_eq!(
        service
            .code_mode_kind(session.id, session.owner_user().unwrap())
            .await,
        CodeModeKind::TypeScript
    );
    // The tool refuses the language.
    assert!(execute(service.clone(), example()).await.is_err());
    // Code mode refuses it too, whatever tool asked.
    let refused = service
        .execute(
            &session,
            ExecutionId::mint(),
            ai_toolset::actor::ToolActor::Requester,
            macro_uuid::Uuid::from_u128(1),
            ExecuteRequest {
                source: example().into(),
                timeout_ms: 30_000,
                language: Language::JsTools,
            },
            CancellationToken::new(),
        )
        .await;
    assert!(matches!(refused, Err(CodeModeError::Invalid(_))));
    assert!(credentials.asked.lock().unwrap().is_empty());
}

/// A runner that is never reached.
struct Never;
#[async_trait]
impl code_execution::domain::CodeRunner for Never {
    async fn run(
        &self,
        _: code_execution::domain::ExecutionJob,
        _: &mut code_execution::domain::EventSink,
        _: CancellationToken,
    ) -> code_execution::domain::Outcome {
        unreachable!("nothing runs")
    }
}
