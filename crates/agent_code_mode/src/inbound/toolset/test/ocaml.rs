//! The OCaml `ExecuteCode` end to end below the MCP adapter: the tool call,
//! [`CodeModeService`](crate::domain::CodeModeService), the real compile step
//! and Deno, against a stub of the storage service. Needs Deno 2.9.6 on
//! `PATH` and a build with `CODE_MODE_OCAML_DIR`
//! (`nix build .#code-mode-ocaml`).

use super::*;
use crate::domain::{
    CodeModeService, ExecutionCredentials, ExecutionIdentity, ExecutionRecord, ExecutionStatus,
    ExecutionStore, ExecutionTurns, IssuedRun, ModelImages, OcamlPrograms, OcamlRollout,
    ProgramLanguage,
};
use agent_session::domain::model::AgentSessionId;
use ai_toolset::ToolSet as _;
use code_execution::domain::{ExecutionService, Limits, RunEnvironment, SdkEndpoints};
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

/// The example returns no images.
struct NoImages;
#[async_trait]
impl ModelImages for NoImages {
    async fn load_png(
        &self,
        _: &crate::domain::StaticFileId,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> anyhow::Result<crate::domain::ModelImage> {
        anyhow::bail!("no images")
    }
}

struct Credentials(String);
#[async_trait]
impl ExecutionCredentials for Credentials {
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        _: &str,
        _: ProgramLanguage,
        _: CancellationToken,
    ) -> Result<IssuedRun, CodeModeError> {
        Ok(IssuedRun {
            environment: RunEnvironment {
                token: "fixture-run-token".into(),
                endpoints: SdkEndpoints {
                    hosts: BTreeMap::from([("storage".into(), self.0.clone())]),
                    web_app_url: "https://app.example.test".into(),
                },
                session_id: Some(identity.session.as_uuid()),
                execution_id: Some(identity.execution.as_uuid()),
                ..Default::default()
            },
            acting_user: identity.owner.clone(),
        })
    }
}

struct On;
#[async_trait]
impl OcamlRollout for On {
    async fn enabled(&self, _: &MacroUserIdStr<'static>) -> bool {
        true
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

/// The OCaml example in ExecuteCode's description.
fn example() -> &'static str {
    let text = include_str!("../session/ocaml.md");
    let start = text.find("```ocaml\n").unwrap() + "```ocaml\n".len();
    let end = start + text[start..].find("```").unwrap();
    &text[start..end]
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime and the OCaml bundle"]
async fn ocaml_tool_example_creates_and_reads_a_task() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().await.unwrap();
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
        }
        requests
    });

    let deno = tokio::process::Command::new("which")
        .arg("deno")
        .output()
        .await
        .unwrap();
    assert!(deno.status.success(), "Deno 2.9.6 must be on PATH");
    let scratch = tempfile::tempdir().unwrap();
    let runner = code_execution::outbound::deno::DenoRunner::new(
        String::from_utf8(deno.stdout).unwrap().trim().into(),
        scratch.path().to_owned(),
        128,
    )
    .await
    .unwrap();
    let fingerprint = runner
        .ocaml_bundle()
        .expect("a build with CODE_MODE_OCAML_DIR")
        .fingerprint()
        .to_owned();
    let store = Arc::new(Store::default());
    let service = CodeModeService::new(
        Some(Arc::new(
            ExecutionService::new(Arc::new(runner), Limits::default()).unwrap(),
        )),
        Arc::new(Credentials(format!("http://{address}"))),
        store.clone(),
        Arc::new(Turn),
        Arc::new(NoImages),
    )
    .with_ocaml(OcamlPrograms {
        fingerprint: fingerprint.clone(),
        rollout: Arc::new(On),
        permissions: None,
    });
    let session = agent_session::testing::test_agent_session(AgentSessionId::new());
    let tools = session_toolset(&service, &session).await;
    let receipt = tools
        .try_tool_call(
            CodeModeToolContext {
                service: Arc::new(service),
                session,
                cognition: None,
            },
            RequestContext::new(user()),
            "ExecuteCode",
            &serde_json::json!({
                "acting_as": "requester",
                "turn_id": "00000000-0000-0000-0000-000000000001",
                "language": "ocaml",
                "source": example(),
            }),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(receipt["status"], "succeeded", "{receipt}");
    assert_eq!(
        receipt["result"],
        serde_json::json!({
            "data": {
                "taskId": "task-1",
                "markdown": "Signing in from a deep link returns to the login page.",
            },
            "reviews": [],
        })
    );
    // The session shows each SDK call, as for a JavaScript run.
    let activity = receipt["activity"].as_array().unwrap();
    assert_eq!(activity.len(), 2, "{receipt}");
    assert!(activity.iter().all(|item| item["status"] == "completed"));

    let requests = server.await.unwrap();
    assert!(requests[0].starts_with("POST /documents/create_task "));
    assert!(requests[1].starts_with("GET /documents/task-1/markdown "));
    for request in &requests {
        let lower = request.to_lowercase();
        assert!(lower.contains("authorization: bearer fixture-run-token"));
        assert!(lower.contains("x-macro-code-execution: 1"));
    }

    let record = store.0.lock().unwrap()[0].clone();
    assert_eq!(record.status, ExecutionStatus::Succeeded);
    assert_eq!(record.language, ProgramLanguage::Ocaml);
    assert_eq!(record.sdk_fingerprint, Some(fingerprint));
    assert_eq!(record.source, example());
}
