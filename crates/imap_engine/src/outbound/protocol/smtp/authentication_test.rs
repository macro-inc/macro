use super::*;
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::test]
async fn authentication_replies_are_classified_at_every_challenge() {
    for (plain, replies, expected) in [
        (true, vec![], Err(Error::ConnectionUnavailable)),
        (true, vec![535], Err(Error::CredentialsRejected)),
        (true, vec![454], Err(Error::ConnectionUnavailable)),
        (true, vec![530], Err(Error::Forbidden)),
        (true, vec![235], Ok(())),
        (false, vec![535], Err(Error::CredentialsRejected)),
        (false, vec![334, 535], Err(Error::CredentialsRejected)),
        (false, vec![334, 334, 535], Err(Error::CredentialsRejected)),
        (false, vec![454], Err(Error::ConnectionUnavailable)),
        (false, vec![334, 454], Err(Error::ConnectionUnavailable)),
        (
            false,
            vec![334, 334, 454],
            Err(Error::ConnectionUnavailable),
        ),
        (false, vec![334, 534], Err(Error::Forbidden)),
        (false, vec![334, 334, 235], Ok(())),
    ] {
        let (mut client, server) = tokio::io::duplex(4096);
        let peer = tokio::spawn(async move {
            let mut server = BufReader::new(server);
            for code in replies {
                let mut command = String::new();
                assert!(server.read_line(&mut command).await.unwrap() > 0);
                server
                    .get_mut()
                    .write_all(format!("{code} synthetic reply\r\n").as_bytes())
                    .await
                    .unwrap();
            }
        });
        let login = Login {
            endpoint: Endpoint {
                host: "smtp.example.com".into(),
                port: 465,
                tls: TlsMode::Implicit,
                username: "synthetic-user".into(),
            },
            password: Secret("synthetic-test-password".into()),
        };
        let extensions = Extensions {
            plain,
            login: !plain,
            ..Extensions::default()
        };
        assert_eq!(
            authenticate(&mut client, &extensions, &login).await,
            expected
        );
        peer.await.unwrap();
    }
}
