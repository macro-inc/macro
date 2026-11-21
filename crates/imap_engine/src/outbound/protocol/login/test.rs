use super::*;
#[test]
fn separates_bad_passwords_from_server_and_exchange_outages() {
    for text in [
        "[AUTHENTICATIONFAILED] bad password",
        "outcome: None, info: Some(\"invalid credentials\")",
        "[EXPIRED] App password expired",
    ] {
        assert_eq!(login_failure(text), Error::CredentialsRejected);
    }
    for text in [
        "[UNAVAILABLE] Authentication failed",
        "[SERVERBUG] backend",
        "[INUSE]",
        "[LIMIT]",
        "User is authenticated but not connected.",
        "temporary refusal",
    ] {
        assert_eq!(login_failure(text), Error::ConnectionUnavailable);
    }
}

#[tokio::test]
async fn parsed_login_response_codes_take_precedence_over_diagnostic_words() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    for (reply, expected) in [
        (
            "NO [AUTHENTICATIONFAILED] Account unavailable",
            Error::CredentialsRejected,
        ),
        (
            "NO [EXPIRED] App password expired",
            Error::CredentialsRejected,
        ),
        (
            "NO [UNAVAILABLE] Authentication failed",
            Error::ConnectionUnavailable,
        ),
        (
            "NO [PRIVACYREQUIRED] Authentication failed",
            Error::Forbidden,
        ),
        ("NO temporary refusal", Error::ConnectionUnavailable),
    ] {
        let (client, server) = tokio::io::duplex(4096);
        let peer = tokio::spawn(async move {
            let mut server = BufReader::new(server);
            let mut command = String::new();
            server.read_line(&mut command).await.unwrap();
            let tag = command.split_ascii_whitespace().next().unwrap();
            server
                .get_mut()
                .write_all(format!("{tag} {reply}\r\n").as_bytes())
                .await
                .unwrap();
        });
        let (error, _) = async_imap::Client::new(client)
            .login("synthetic-user", "synthetic-test-password")
            .await
            .err()
            .unwrap();
        peer.await.unwrap();
        assert_eq!(super::super::wire::imap_error(error, true), expected);
    }
}
