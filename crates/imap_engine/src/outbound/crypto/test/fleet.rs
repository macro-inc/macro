use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[tokio::test]
async fn kms_configuration_drift_never_parks_a_fleet_and_corruption_needs_a_good_canary() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let context_mismatch = Arc::new(AtomicBool::new(false));
    let mismatch = context_mismatch.clone();
    let verification_only = Arc::new(AtomicBool::new(false));
    let verification = verification_only.clone();
    let server = tokio::spawn(async move {
        loop {
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
            assert!(length < 16 * 1024);
            let mut body = vec![0; length];
            socket.read_exact(&mut body).await.unwrap();
            let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let ciphertext = STANDARD
                .decode(request["CiphertextBlob"].as_str().unwrap())
                .unwrap();
            let rejected = mismatch.load(Ordering::Acquire) || ciphertext.last() == Some(&255);
            let login = Login {
                endpoint: Endpoint {
                    host: "mail.example.com".into(),
                    port: 993,
                    tls: TlsMode::Implicit,
                    username: "user@example.com".into(),
                },
                password: Secret("synthetic-password".into()),
            };
            let plaintext = serde_json::to_vec(&Credentials {
                features: None,
                binding: if verification.load(Ordering::Acquire) {
                    None
                } else {
                    Some(Binding {
                        link_id: Uuid::parse_str(
                            request["EncryptionContext"]["object_id"].as_str().unwrap(),
                        )
                        .unwrap(),
                        sync_generation: 1,
                        grant_generation: 1,
                    })
                },
                user_id: "owner".into(),
                email: "user@example.com".into(),
                imap: login.clone(),
                smtp: login,
            })
            .unwrap();
            let response = if rejected {
                serde_json::json!({"__type": "InvalidCiphertextException", "message": "synthetic failure"})
            } else {
                serde_json::json!({"KeyId": "arn:aws:kms:us-east-1:000000000000:key/synthetic", "Plaintext": STANDARD.encode(plaintext)})
            }.to_string();
            let status = if rejected { 400 } else { 200 };
            socket.get_mut().write_all(format!("HTTP/1.1 {status} Synthetic\r\nContent-Type: application/x-amz-json-1.1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).as_bytes()).await.unwrap();
            socket.get_mut().flush().await.unwrap();
        }
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
    let client = Client::from_conf(config);
    let isolated = KmsCipher::new(client.clone(), "alias/synthetic".into());
    verification_only.store(true, Ordering::Release);
    for _ in 0..30 {
        assert!(
            isolated
                .decrypt(Uuid::now_v7(), "owner", &[1])
                .await
                .is_ok()
        );
    }
    verification_only.store(false, Ordering::Release);
    let account = Uuid::now_v7();
    assert!(isolated.decrypt(account, "owner", &[1]).await.is_ok());
    // Verification ids are not accounts and cannot dilute the fleet guard.
    assert!(matches!(
        isolated.decrypt(account, "owner", &[1, 255]).await,
        Err(Error::CredentialsUnavailable)
    ));
    let cipher = KmsCipher::new(client, "alias/synthetic".into());
    let ids: Vec<_> = (0..25).map(|_| Uuid::now_v7()).collect();
    for id in &ids {
        assert!(cipher.decrypt(*id, "owner", &[1]).await.is_ok());
    }
    context_mismatch.store(true, Ordering::Release);
    for id in &ids {
        assert!(matches!(
            cipher.decrypt(*id, "owner", &[1, 255]).await,
            Err(Error::CredentialsUnavailable)
        ));
    }
    context_mismatch.store(false, Ordering::Release);
    assert!(matches!(
        cipher.decrypt(ids[0], "owner", &[1, 255]).await,
        Err(Error::CredentialsUnreadable)
    ));
    // Two of twenty-five accounts exceed the approved five-percent fleet guard.
    assert!(matches!(
        cipher.decrypt(ids[1], "owner", &[1, 255]).await,
        Err(Error::CredentialsUnavailable)
    ));
    // An unproven context never inherits another binding's successful decrypt.
    assert!(matches!(
        cipher.decrypt(ids[2], "changed-owner", &[1, 255]).await,
        Err(Error::CredentialsUnavailable)
    ));
    tokio::time::pause();
    tokio::time::advance(std::time::Duration::from_secs(601)).await;
    tokio::time::resume();
    assert!(matches!(
        cipher.decrypt(ids[0], "owner", &[1, 255]).await,
        Err(Error::CredentialsUnavailable)
    ));
    server.abort();
    let _ = server.await;
}
