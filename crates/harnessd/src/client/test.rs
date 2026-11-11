use super::*;
use crate::auth::{AgentAuth, AgentStatus, Agents};
use std::sync::Arc;

struct SignedOutClaude;

impl AgentAuth for SignedOutClaude {
    async fn start(&self) -> Result<String, ErrorKind> {
        Ok("https://claude.com/cai/oauth/authorize?code=true&state=abc".to_owned())
    }

    async fn complete(&self, _code: String) -> Result<AgentStatus, ErrorKind> {
        Err(ErrorKind::NoPendingSignIn)
    }

    async fn cancel(&self) -> Result<AgentStatus, ErrorKind> {
        Ok(AgentStatus::SignedOut)
    }

    async fn sign_out(&self) -> Result<(), ErrorKind> {
        Ok(())
    }

    async fn status(&self) -> Result<AgentStatus, ErrorKind> {
        Ok(AgentStatus::SignedOut)
    }
}

#[tokio::test]
async fn the_client_forwards_requests_to_a_running_daemon() {
    let directory = tempfile::tempdir().expect("a directory");
    let socket = directory.path().join("harnessd.sock");
    let listener = crate::socket::listen(&socket).expect("listening");
    let daemon = tokio::spawn(crate::socket::serve(
        listener,
        Arc::new(Agents {
            claude: SignedOutClaude,
        }),
    ));
    let input = concat!(
        r#"{"command":"status","agent":"claude"}"#,
        "\n",
        r#"{"command":"sign_in_start","agent":"claude"}"#,
    );
    let mut output = Vec::new();

    let outcome = run(&socket, input.as_bytes(), &mut output)
        .await
        .expect("ran");

    assert_eq!(outcome, ClientOutcome::Answered);
    assert_eq!(
        String::from_utf8(output).expect("utf-8"),
        concat!(
            r#"{"result":"signed_out","agent":"claude"}"#,
            "\n",
            r#"{"result":"sign_in_started","agent":"claude","url":"https://claude.com/cai/oauth/authorize?code=true&state=abc"}"#,
            "\n",
        )
    );
    daemon.abort();
}

#[tokio::test]
async fn without_a_daemon_every_request_is_unavailable() {
    let directory = tempfile::tempdir().expect("a directory");
    let socket = directory.path().join("harnessd.sock");
    let input = concat!(
        r#"{"command":"status","agent":"claude"}"#,
        "\n",
        "not json\n",
        r#"{"command":"sign_out","agent":"claude"}"#,
        "\n",
    );
    let mut output = Vec::new();

    let outcome = run(&socket, input.as_bytes(), &mut output)
        .await
        .expect("ran");

    assert_eq!(outcome, ClientOutcome::Unavailable);
    assert_eq!(
        String::from_utf8(output).expect("utf-8"),
        concat!(
            r#"{"result":"error","agent":"claude","kind":"unavailable"}"#,
            "\n",
            r#"{"result":"error","kind":"unavailable"}"#,
            "\n",
            r#"{"result":"error","agent":"claude","kind":"unavailable"}"#,
            "\n",
        )
    );
}
