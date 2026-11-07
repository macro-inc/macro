use super::*;
use chrono::{DateTime, Utc};
use harnessd_protocol::ClaudeAccount;
use std::sync::Mutex;

/// Answers from a script, and records the codes it was given.
struct ScriptedClaude {
    status: AgentStatus,
    completed_codes: Mutex<Vec<String>>,
}

impl AgentAuth for ScriptedClaude {
    async fn start(&self) -> Result<String, ErrorKind> {
        Ok("https://claude.com/cai/oauth/authorize?code=true&state=abc".to_owned())
    }

    async fn complete(&self, code: String) -> Result<AgentStatus, ErrorKind> {
        let rejected = code == "rejected#abc";
        self.completed_codes.lock().expect("codes").push(code);
        if rejected {
            return Err(ErrorKind::InvalidCode);
        }
        Ok(self.status.clone())
    }

    async fn cancel(&self) -> Result<AgentStatus, ErrorKind> {
        Ok(AgentStatus::SignedOut)
    }

    async fn sign_out(&self) -> Result<(), ErrorKind> {
        Ok(())
    }

    async fn status(&self) -> Result<AgentStatus, ErrorKind> {
        Ok(AgentStatus::Pending)
    }
}

#[tokio::test]
async fn every_request_line_gets_one_answer_line_in_order() {
    let agents = Agents {
        claude: ScriptedClaude {
            status: AgentStatus::SignedIn(Account::Claude(ClaudeAccount {
                credential_id: "sha256:0123456789abcdef0123456789abcdef".to_owned(),
                expires_at: Some(
                    DateTime::parse_from_rfc3339("2027-11-11T22:00:00Z")
                        .expect("a time")
                        .with_timezone(&Utc),
                ),
            })),
            completed_codes: Mutex::new(Vec::new()),
        },
    };
    let input = concat!(
        r#"{"command":"sign_in_start","agent":"claude"}"#,
        "\n",
        r#"{"command":"status","agent":"claude"}"#,
        "\n",
        "\n",
        r#"{"command":"sign_in_complete","agent":"claude","code":"rejected#abc"}"#,
        "\n",
        r#"{"command":"sign_in_complete","agent":"claude","code":"good#abc"}"#,
        "\n",
        "not json\n",
        r#"{"command":"status","agent":"codex"}"#,
        "\n",
        r#"{"command":"sign_in_cancel","agent":"claude"}"#,
        "\n",
        r#"{"command":"sign_out","agent":"claude"}"#,
    );
    let mut output = Vec::new();

    serve_connection(&agents, input.as_bytes(), &mut output)
        .await
        .expect("served");

    assert_eq!(
        String::from_utf8(output).expect("utf-8"),
        concat!(
            r#"{"result":"sign_in_started","agent":"claude","url":"https://claude.com/cai/oauth/authorize?code=true&state=abc"}"#,
            "\n",
            r#"{"result":"pending","agent":"claude"}"#,
            "\n",
            r#"{"result":"error","agent":"claude","kind":"invalid_code"}"#,
            "\n",
            r#"{"result":"signed_in","agent":"claude","claude":{"credential_id":"sha256:0123456789abcdef0123456789abcdef","expires_at":"2027-11-11T22:00:00Z"}}"#,
            "\n",
            r#"{"result":"error","kind":"invalid_request"}"#,
            "\n",
            r#"{"result":"error","kind":"invalid_request"}"#,
            "\n",
            r#"{"result":"signed_out","agent":"claude"}"#,
            "\n",
            r#"{"result":"signed_out","agent":"claude"}"#,
            "\n",
        )
    );
    assert_eq!(
        *agents.claude.completed_codes.lock().expect("codes"),
        vec!["rejected#abc".to_owned(), "good#abc".to_owned()]
    );
}
