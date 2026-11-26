mod fleet;
use super::*;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

#[tokio::test]
async fn kms_decrypt_distinguishes_unreadable_ciphertext_from_service_outages() {
    for (code, status, expected) in [
        (
            "IncorrectKeyException",
            400,
            Some("credentials_unavailable"),
        ),
        (
            "InvalidCiphertextException",
            400,
            Some("credentials_unavailable"),
        ),
        ("KMSInternalException", 500, Some("credentials_unavailable")),
        (
            "KeyUnavailableException",
            500,
            Some("credentials_unavailable"),
        ),
        ("NotFoundException", 400, Some("credentials_unavailable")),
        ("DisabledException", 400, Some("credentials_unavailable")),
        ("Malformed", 200, Some("credentials_unavailable")),
        ("Recovered", 200, None),
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let login = Login {
            endpoint: Endpoint {
                host: "mail.example.com".into(),
                port: 993,
                tls: TlsMode::Implicit,
                username: "user@example.com".into(),
            },
            password: Secret("synthetic-password".into()),
        };
        let credentials = Credentials {
            features: None,
            binding: None,
            user_id: "owner".into(),
            email: "user@example.com".into(),
            imap: login.clone(),
            smtp: login,
        };
        let plaintext = if code == "Malformed" {
            b"[".to_vec()
        } else {
            serde_json::to_vec(&credentials).unwrap()
        };
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = BufReader::new(socket);
            let mut length = 0;
            loop {
                let mut line = String::new();
                assert!(socket.read_line(&mut line).await.unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse::<usize>().unwrap();
                }
            }
            // Consume only this synthetic request; never log authorization or payloads.
            assert!(length < 16 * 1024);
            let mut body = vec![0; length];
            socket.read_exact(&mut body).await.unwrap();
            use base64::{Engine as _, engine::general_purpose::STANDARD};
            let response = if status == 200 {
                serde_json::json!({"Plaintext": STANDARD.encode(plaintext)})
            } else {
                serde_json::json!({"__type": code, "message": "synthetic key service failure"})
            }
            .to_string();
            socket.get_mut().write_all(format!(
                "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/x-amz-json-1.1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                response.len(),
            ).as_bytes()).await.unwrap();
            socket.get_mut().flush().await.unwrap();
        });
        let config = aws_sdk_kms::Config::builder()
            .behavior_version_latest()
            .region(aws_sdk_kms::config::Region::new("us-east-1"))
            .credentials_provider(aws_sdk_kms::config::Credentials::new(
                "test",
                "test",
                None,
                None,
                "synthetic",
            ))
            .endpoint_url(format!("http://{address}"))
            .retry_config(aws_sdk_kms::config::retry::RetryConfig::standard().with_max_attempts(1))
            .build();
        let cipher = KmsCipher::new(Client::from_conf(config), "alias/synthetic".into());
        let result = cipher
            .decrypt(Uuid::now_v7(), "synthetic-owner", &[1, 2, 3])
            .await;
        if let Some(expected) = expected {
            assert_eq!(serde_json::to_value(result.unwrap_err()).unwrap(), expected);
        } else {
            let recovered = result.unwrap();
            assert_eq!(recovered.imap.endpoint.host, credentials.imap.endpoint.host);
            assert_eq!(
                recovered.smtp.endpoint.username,
                credentials.smtp.endpoint.username
            );
            assert_eq!(recovered.imap.endpoint.tls, credentials.imap.endpoint.tls);
        }
        server.await.unwrap();
    }
}
