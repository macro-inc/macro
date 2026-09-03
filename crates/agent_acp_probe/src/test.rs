use super::*;
use agent_client_protocol::Agent;
use agent_client_protocol::schema::v1::{
    InitializeResponse, NewSessionResponse, SessionConfigOption, SessionConfigSelectOption,
    SessionConfigValueId, SessionId,
};

fn model_options(current: &str) -> Vec<SessionConfigOption> {
    vec![SessionConfigOption::select(
        "model",
        "Model",
        SessionConfigValueId::new(current),
        vec![
            SessionConfigSelectOption::new(SessionConfigValueId::new("fast"), "Fast"),
            SessionConfigSelectOption::new(SessionConfigValueId::new("good"), "Good"),
        ],
    )]
}

#[tokio::test]
async fn connected_probe_initializes_and_opens_without_prompting() {
    let (client_channel, agent_channel) = Channel::duplex();
    let agent = tokio::spawn(
        Agent
            .builder()
            .on_receive_request(
                async |request: InitializeRequest, responder, _connection| {
                    responder.respond(InitializeResponse::new(request.protocol_version))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async |_: NewSessionRequest, responder, _connection| {
                    responder.respond(
                        NewSessionResponse::new(SessionId::new("probe"))
                            .config_options(model_options("fast")),
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_to(agent_channel),
    );

    let options = probe_channel(
        client_channel,
        Path::new("/workspace"),
        Duration::from_secs(1),
    )
    .await
    .expect("probe should complete");

    assert_eq!(options, model_options("fast"));
    agent.abort();
}

#[tokio::test]
async fn connected_probe_is_bounded() {
    let (client_channel, _silent_peer) = Channel::duplex();

    let error = probe_channel(
        client_channel,
        Path::new("/workspace"),
        Duration::from_millis(10),
    )
    .await
    .expect_err("silent peer should time out");

    assert!(matches!(error, ProbeError::Timeout(_)));
}

#[cfg(unix)]
#[tokio::test]
async fn subprocess_probe_uses_configured_command_arguments_and_cwd() {
    let cwd = tempfile::tempdir().expect("temporary cwd");
    let script = r#"
import json, os, sys
initialize = json.loads(sys.stdin.readline())
print(json.dumps({"jsonrpc":"2.0","id":initialize["id"],"result":{
  "protocolVersion":1,"agentCapabilities":{}
}}), flush=True)
opening = json.loads(sys.stdin.readline())
assert opening["method"] == "session/new"
current = os.path.basename(os.getcwd()) + ":" + sys.argv[1]
print(json.dumps({"jsonrpc":"2.0","id":opening["id"],"result":{
  "sessionId":"probe",
  "configOptions":[{
    "id":"model","name":"Model","type":"select","currentValue":current,
    "options":[{"value":current,"name":current}]
  }]
}}), flush=True)
sys.stdin.read()
"#;
    let process = ProbeSubprocess {
        command: "python3".into(),
        args: vec!["-c".to_owned(), script.to_owned(), "argument".to_owned()],
        cwd: cwd.path().to_owned(),
    };

    let options = probe_subprocess(&process, Duration::from_secs(2))
        .await
        .expect("subprocess probe should complete");
    let encoded = serde_json::to_value(options).expect("options serialize");

    assert_eq!(
        encoded[0]["currentValue"],
        format!(
            "{}:argument",
            cwd.path().file_name().unwrap().to_string_lossy()
        )
    );
}
