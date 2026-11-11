use super::*;

#[test]
fn requests_read_from_their_json_lines() {
    let lines = [
        r#"{"command":"sign_in_start","agent":"claude"}"#,
        r#"{"command":"sign_in_complete","agent":"claude","code":"abc#def"}"#,
        r#"{"command":"sign_in_cancel","agent":"claude"}"#,
        r#"{"command":"sign_out","agent":"claude"}"#,
        r#"{"command":"status","agent":"claude"}"#,
    ];
    let requests: Vec<Request> = lines
        .iter()
        .map(|line| serde_json::from_str(line).expect("a request"))
        .collect();
    assert_eq!(
        requests,
        vec![
            Request::SignInStart {
                agent: AgentProvider::Claude
            },
            Request::SignInComplete {
                agent: AgentProvider::Claude,
                code: "abc#def".to_owned()
            },
            Request::SignInCancel {
                agent: AgentProvider::Claude
            },
            Request::SignOut {
                agent: AgentProvider::Claude
            },
            Request::Status {
                agent: AgentProvider::Claude
            },
        ]
    );
}

#[test]
fn an_unknown_agent_is_not_a_request() {
    let parsed = serde_json::from_str::<Request>(r#"{"command":"status","agent":"codex"}"#);
    assert!(parsed.is_err());
}

#[test]
fn responses_write_their_json_lines() {
    let responses = [
        Response::SignInStarted {
            agent: AgentProvider::Claude,
            url: "https://claude.com/cai/oauth/authorize?code=true".to_owned(),
        },
        Response::SignedIn {
            agent: AgentProvider::Claude,
            claude: Some(ClaudeAccount {
                credential_id: "sha256:0123456789abcdef0123456789abcdef".to_owned(),
                expires_at: Some(
                    DateTime::parse_from_rfc3339("2027-11-11T22:00:00Z")
                        .expect("a time")
                        .with_timezone(&Utc),
                ),
            }),
        },
        Response::SignedOut {
            agent: AgentProvider::Claude,
        },
        Response::Pending {
            agent: AgentProvider::Claude,
        },
        Response::Error {
            agent: Some(AgentProvider::Claude),
            kind: ErrorKind::InvalidCode,
        },
        Response::Error {
            agent: None,
            kind: ErrorKind::InvalidRequest,
        },
    ];
    let lines: Vec<String> = responses
        .iter()
        .map(|response| serde_json::to_string(response).expect("json"))
        .collect();
    assert_eq!(
        lines,
        vec![
            r#"{"result":"sign_in_started","agent":"claude","url":"https://claude.com/cai/oauth/authorize?code=true"}"#,
            r#"{"result":"signed_in","agent":"claude","claude":{"credential_id":"sha256:0123456789abcdef0123456789abcdef","expires_at":"2027-11-11T22:00:00Z"}}"#,
            r#"{"result":"signed_out","agent":"claude"}"#,
            r#"{"result":"pending","agent":"claude"}"#,
            r#"{"result":"error","agent":"claude","kind":"invalid_code"}"#,
            r#"{"result":"error","kind":"invalid_request"}"#,
        ]
    );
}
