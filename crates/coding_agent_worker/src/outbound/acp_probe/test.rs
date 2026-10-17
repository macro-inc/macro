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
        env: Default::default(),
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

#[cfg(unix)]
#[tokio::test]
async fn subprocess_exit_after_stdio_closes_is_a_process_failure() {
    let process = ProbeSubprocess {
        command: "/bin/sh".into(),
        args: vec![
            "-c".to_owned(),
            "exec 1>&-; sleep 0.05; exit 127".to_owned(),
        ],
        cwd: "/".into(),
        env: Default::default(),
    };

    let error = probe_subprocess(&process, Duration::from_secs(2))
        .await
        .expect_err("a failing child cannot provide models");

    assert!(matches!(error, ProbeError::Process(_)), "got {error:?}");
}

fn legacy_response(current: Value) -> Value {
    serde_json::json!({
        "sessionId": "probe",
        "models": {
            "currentModelId": current,
            "availableModels": [
                {"modelId": "provider/fast", "name": "Fast", "description": "Quick"},
                {"modelId": "provider/good", "name": "Good"}
            ]
        }
    })
}

#[test]
fn raw_probe_request_preserves_sdk_method_and_parameters() {
    let original = NewSessionRequest::new("/workspace");
    let request = ProbeNewSessionRequest(original.clone());
    assert_eq!(
        serde_json::to_value(&request).unwrap(),
        serde_json::to_value(&original).unwrap()
    );
    assert_eq!(agent_client_protocol::JsonRpcMessage::method(&request), "session/new");
    assert!(<ProbeNewSessionRequest as agent_client_protocol::JsonRpcMessage>::matches_method("session/new"));
    assert!(!<ProbeNewSessionRequest as agent_client_protocol::JsonRpcMessage>::matches_method("session/prompt"));
}

#[test]
fn legacy_models_preserve_ids_names_description_and_current() {
    let options = probe_config_options(legacy_response(serde_json::json!("provider/good")))
        .expect("legacy models decode");
    let encoded = serde_json::to_value(&options).unwrap();
    assert_eq!(encoded[0]["id"], "model");
    assert_eq!(encoded[0]["category"], "model");
    assert_eq!(encoded[0]["type"], "select");
    assert_eq!(encoded[0]["currentValue"], "provider/good");
    assert_eq!(encoded[0]["options"], serde_json::json!([
        {"value": "provider/fast", "name": "Fast", "description": "Quick"},
        {"value": "provider/good", "name": "Good"}
    ]));
}

#[test]
fn absent_or_unknown_current_uses_first_advertised_model() {
    for current in [Value::Null, serde_json::json!("not-advertised")] {
        let options = probe_config_options(legacy_response(current)).unwrap();
        let selection = agent_fold::domain::model_selection::model_selection(&options).unwrap();
        assert_eq!(selection.current, "provider/fast");
        assert_eq!(selection.options.len(), 2);
    }
    let mut response = legacy_response(Value::Null);
    response["models"].as_object_mut().unwrap().remove("currentModelId");
    let options = probe_config_options(response).unwrap();
    assert_eq!(agent_fold::domain::model_selection::model_selection(&options).unwrap().current, "provider/fast");
}

#[test]
fn modern_model_precedes_even_invalid_legacy_and_keeps_other_options() {
    let mut modern = model_options("good");
    modern.push(SessionConfigOption::boolean("permission", "Permission", true));
    let response = serde_json::json!({
        "sessionId": "probe", "configOptions": modern, "models": "invalid"
    });
    assert_eq!(probe_config_options(response).unwrap(), modern);
}

#[test]
fn grouped_modern_model_is_preserved_without_flattening() {
    let raw = serde_json::json!([{
        "id": "model", "name": "Model", "category": "model", "type": "select",
        "currentValue": "grouped", "options": [{"group": "provider", "name": "Provider",
            "options": [{"value": "grouped", "name": "Grouped"}]}]
    }]);
    let modern: Vec<SessionConfigOption> = serde_json::from_value(raw).unwrap();
    let mut response = legacy_response(Value::Null);
    response["configOptions"] = serde_json::to_value(&modern).unwrap();
    let options = probe_config_options(response).unwrap();
    assert_eq!(options, modern);
    let selection = agent_fold::domain::model_selection::model_selection(&options).unwrap();
    assert_eq!(selection.current, "grouped");
    assert_eq!(selection.options[0].group.as_deref(), Some("Provider"));
}

#[test]
fn category_only_model_keeps_id_only_projection_semantics() {
    let modern = vec![SessionConfigOption::select(
        "provider-selector", "Provider model", SessionConfigValueId::new("good"),
        vec![SessionConfigSelectOption::new(SessionConfigValueId::new("good"), "Good")],
    ).category(SessionConfigOptionCategory::Model)];
    assert!(agent_fold::domain::model_selection::model_selection(&modern).is_none());
    let mut response = legacy_response(Value::Null);
    response["configOptions"] = serde_json::to_value(&modern).unwrap();
    let options = probe_config_options(response).unwrap();
    assert_eq!(&options[..1], modern.as_slice());
    assert_eq!(agent_fold::domain::model_selection::model_selection(&options).unwrap().current, "provider/fast");
}

#[test]
fn missing_null_or_empty_legacy_keeps_other_modern_options() {
    let other = vec![SessionConfigOption::boolean("permission", "Permission", true)];
    for models in [Value::Null, serde_json::json!({"availableModels": []})] {
        let response = serde_json::json!({"sessionId": "probe", "configOptions": other, "models": models});
        assert_eq!(probe_config_options(response).unwrap(), other);
    }
    assert_eq!(probe_config_options(serde_json::json!({"sessionId":"probe", "configOptions":other})).unwrap(), other);
}

#[test]
fn fallback_appends_without_changing_other_modern_options() {
    let other = SessionConfigOption::boolean("permission", "Permission", true);
    let mut response = legacy_response(Value::Null);
    response["configOptions"] = serde_json::json!([other]);
    let options = probe_config_options(response).unwrap();
    assert_eq!(options.len(), 2);
    assert_eq!(options[0], other);
    assert_eq!(options[1].id.to_string(), "model");
}

#[test]
fn malformed_legacy_models_fail_instead_of_inventing_models() {
    for models in [
        serde_json::json!("invalid"),
        serde_json::json!({}),
        serde_json::json!({"availableModels": null}),
        serde_json::json!({"availableModels": [{"modelId": "", "name": "Empty"}]}),
        serde_json::json!({"availableModels": [{"modelId": "x"}]}),
        serde_json::json!({"availableModels": [{"modelId": "x", "name": " "}]}),
        serde_json::json!({"availableModels": [{"modelId": 1, "name": "Numeric"}]}),
        serde_json::json!({"availableModels": [{"modelId": "x", "name": "X", "description": 1}]}),
        serde_json::json!({"availableModels": [{"modelId": "x", "name": "X"}, {"modelId": "x", "name": "Duplicate"}]}),
        serde_json::json!({"currentModelId": 1, "availableModels": [{"modelId": "x", "name": "X"}]}),
    ] {
        assert!(probe_config_options(serde_json::json!({"sessionId":"probe", "models":models})).is_err());
    }
    assert!(probe_config_options(serde_json::json!({"models":{"availableModels":[]}})).is_err());
}

#[tokio::test]
async fn connected_probe_captures_legacy_before_sdk_discards_it() {
    let (client_channel, agent_channel) = Channel::duplex();
    let agent = tokio::spawn(
        Agent.builder()
            .on_receive_request(
                async |request: InitializeRequest, responder, _connection| {
                    responder.respond(InitializeResponse::new(request.protocol_version))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async |request: ProbeNewSessionRequest, responder, _connection| {
                    assert_eq!(serde_json::to_value(request).unwrap()["cwd"], "/workspace");
                    responder.respond(legacy_response(serde_json::json!("provider/good")))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_to(agent_channel),
    );
    let options = probe_channel(client_channel, Path::new("/workspace"), Duration::from_secs(1))
        .await.expect("raw legacy response reaches converter");
    let selection = agent_fold::domain::model_selection::model_selection(&options).unwrap();
    assert_eq!(selection.current, "provider/good");
    assert_eq!(selection.options.len(), 2);
    agent.abort();
}

#[tokio::test]
async fn connected_probe_preserves_rpc_errors() {
    let (client_channel, agent_channel) = Channel::duplex();
    let agent = tokio::spawn(
        Agent.builder()
            .on_receive_request(
                async |request: InitializeRequest, responder, _connection| {
                    responder.respond(InitializeResponse::new(request.protocol_version))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async |_: ProbeNewSessionRequest, responder, _connection| {
                    responder.respond_with_error(agent_client_protocol::Error::method_not_found())
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_to(agent_channel),
    );
    let error = probe_channel(client_channel, Path::new("/workspace"), Duration::from_secs(1))
        .await.expect_err("RPC error must not become unsupported or invented models");
    assert!(matches!(error, ProbeError::Protocol(_)));
    agent.abort();
}
