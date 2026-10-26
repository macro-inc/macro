use super::*;
use crate::config::{HarnessCredentials, HarnessScope, MacroApi};
use crate::herdr::acp_agent::TuiAgent;
use harness_id::HarnessId;
use serde_json::json;
use std::os::unix::fs::PermissionsExt as _;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

#[tokio::test]
async fn generated_names_and_later_renames_update_only_the_matching_session_tab() {
    let root = tempfile::tempdir().unwrap();
    let macro_id = uuid::Uuid::new_v4();
    let cwd = root.path().join("worktrees").join(macro_id.to_string());
    let script = root.path().join("herdr");
    std::fs::write(&script, include_str!("../acp_agent/windows/herdr.sh")).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let pane = json!({"result":{"pane":{
        "pane_id":"w1:p2","tab_id":"w1:t2","cwd":cwd,"foreground_cwd":cwd
    }}});
    std::fs::write(root.path().join("pane.json"), pane.to_string()).unwrap();
    Store(root.path().to_owned())
        .save(&Record {
            version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            kind: TuiAgent::Codex,
            cwd: cwd.clone(),
            model: "default".to_owned(),
            native_id: None,
            window: Some(Window {
                tab_id: "w1:t2".to_owned(),
                pane_id: "w1:p2".to_owned(),
            }),
            transcript: None,
            started: 1,
        })
        .unwrap();

    std::fs::write(
        root.path()
            .join("sessions")
            .join(format!("{}.json", uuid::Uuid::new_v4())),
        "incomplete record",
    )
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for name in [
            "Add feature request",
            "Add feature request",
            "Add feature request",
            "Open channel in new split",
            "Updated session name",
            "Updated session name",
        ] {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let read = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.starts_with("GET /harnesses/me/sessions "));
            assert!(request.contains("x-macro-harness-token: mhns_test"));
            let row = json!({
                "session_id":macro_id,"bot_id":uuid::Uuid::nil(),
                "bot_name":"Test agent","bot_handle":"test-agent","name":name,
                "status":"active","model":"default","owner_id":"macro|test@example.invalid",
                "created_at":"2026-10-26T00:00:00Z","modified_at":"2026-10-26T00:00:00Z"
            });
            let mut unrelated = row.clone();
            unrelated["session_id"] = json!(uuid::Uuid::new_v4());
            unrelated["name"] = json!("Unrelated session");
            let body = json!([row, unrelated]).to_string();
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });
    let client = EventStreamClient::new(
        &MacroApi {
            storage_url: format!("http://{address}"),
            api_url: "http://unused".to_owned(),
            web_url: "http://unused".to_owned(),
        },
        &HarnessCredentials {
            harness_id: HarnessId::TEST_A,
            token: "mhns_test".to_owned(),
            scope: HarnessScope::User,
        },
    );
    let mut sync = TitleSync::new(
        client,
        HerdrCli::new(script, Some("w1".to_owned())),
        root.path().to_owned(),
        root.path().join("worktrees"),
    );
    sync.refresh().await.unwrap();
    sync.refresh().await.unwrap();
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.matches("tab rename").count(), 1);
    let mut moved = pane.clone();
    moved["result"]["pane"]["tab_id"] = json!("w1:t3");
    moved["result"]["pane"]["pane_id"] = json!("w1:p3");
    std::fs::write(root.path().join("pane.json"), moved.to_string()).unwrap();
    sync.refresh().await.unwrap();
    sync.refresh().await.unwrap();
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.matches("tab rename").count(), 3);
    assert!(calls.contains("tab rename w1:t3 Add feature request"));
    assert!(calls.contains("tab rename w1:t3 Open channel in new split"));
    assert!(!calls.contains("Unrelated session"));
    assert!(!calls.contains("pane run"));

    let mut replaced = moved.clone();
    replaced["result"]["pane"]["foreground_cwd"] = json!(root.path().join("other"));
    std::fs::write(root.path().join("pane.json"), replaced.to_string()).unwrap();
    assert!(sync.refresh().await.is_err());
    std::fs::write(root.path().join("pane.json"), moved.to_string()).unwrap();
    sync.refresh().await.unwrap();
    let calls = std::fs::read_to_string(root.path().join("calls")).unwrap();
    assert_eq!(calls.matches("tab rename").count(), 4);
    assert!(calls.contains("tab rename w1:t3 Updated session name"));
    server.await.unwrap();
}
