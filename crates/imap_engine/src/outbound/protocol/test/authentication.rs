//! Real TLS authentication refusals and retries against an explicitly selected lab.
use super::*;

#[tokio::test]
#[ignore = "requires the owned Dovecot lab and explicit IMAP_TEST_ENDPOINT_MAP"]
async fn real_tls_authentication_refusals_allow_a_successful_retry() {
    let addresses: BTreeMap<String, String> = serde_json::from_str(
        &macro_env_var::read_env("IMAP_TEST_ENDPOINT_MAP").expect("explicit local lab endpoints"),
    )
    .unwrap();
    assert!(addresses.contains_key("maillab.example.net:993"));
    assert!(addresses.contains_key("maillab.example.net:465"));
    let ca = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated/ca.pem"),
    )
    .unwrap();
    let transport = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses,
            trust_root_pem: Some(ca),
        })
        .unwrap(),
    );
    let email = format!("auth-retry-{}@example.com", uuid::Uuid::now_v7());
    let login = |port| Login {
        endpoint: Endpoint {
            host: "maillab.example.net".into(),
            port,
            tls: TlsMode::Implicit,
            username: email.clone(),
        },
        password: Secret("pass".into()),
    };
    let credentials = Credentials {
        features: None,
        binding: None,
        user_id: "synthetic-owner".into(),
        email: email.clone(),
        imap: login(993),
        smtp: login(465),
    };

    let mut wrong_imap = credentials.clone();
    wrong_imap.imap.password = Secret("incorrect-test-password".into());
    assert_eq!(
        transport.verify(&wrong_imap).await,
        Err(Error::CredentialsRejected)
    );
    transport.verify(&credentials).await.unwrap();

    let mut wrong_smtp = credentials.clone();
    wrong_smtp.smtp.password = Secret("incorrect-test-password".into());
    assert_eq!(
        transport.verify(&wrong_smtp).await,
        Err(Error::CredentialsRejected)
    );
    transport.verify(&credentials).await.unwrap();
}
