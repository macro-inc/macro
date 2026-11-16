use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path, query_param},
};

#[tokio::test]
async fn login_and_versioned_cas_wire_contract() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/macro/login"))
        .and(header("X-Vault-Namespace", "team-fixture"))
        .and(header("x-macro-audit-id", "audit-fixture"))
        .and(body_json(
            serde_json::json!({"jwt":"synthetic-jwt","role":"passwords-service"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"auth":{"client_token":"synthetic-token","lease_duration":60}}),
        ))
        .expect(1)
        .mount(&server)
        .await;
    let client = OpenBaoClient::new(&server.uri()).expect("client");
    let session = client
        .login_team(
            "team-fixture",
            "passwords-service",
            &SecretString::new("synthetic-jwt".into()),
            Some("audit-fixture"),
        )
        .await
        .expect("login");
    assert!(!format!("{session:?}").contains("synthetic-token"));
    assert_eq!(session.lease_duration(), Duration::from_secs(60));
    Mock::given(method("POST"))
        .and(path("/v1/passwords/data/item"))
        .and(header("X-Vault-Namespace", "team-fixture"))
        .and(header("X-Vault-Token", "synthetic-token"))
        .and(body_json(
            serde_json::json!({"data":{"password":"synthetic-password"},"options":{"cas":7}}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"data":{"version":8,"created_time":"2026-01-01T00:00:00Z"}}),
        ))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        client
            .write(
                &session,
                "item",
                7,
                &serde_json::json!({"password":"synthetic-password"}),
                None
            )
            .await
            .expect("write"),
        8
    );
    Mock::given(method("GET")).and(path("/v1/passwords/data/item")).and(query_param("version","7"))
        .and(header("X-Vault-Namespace", "team-fixture"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"data":{"password":"historical-password"},"metadata":{"version":7,"created_time":"2026-01-01T00:00:00Z","deletion_time":"","destroyed":false}}})))
        .expect(1).mount(&server).await;
    let value: serde_json::Value = client
        .read(&session, "item", Some(7), None)
        .await
        .expect("read");
    assert_eq!(value["password"], "historical-password");
    let requests = server.received_requests().await.expect("requests");
    assert!(
        !requests[0].headers.contains_key("X-Vault-Token"),
        "login has no bootstrap credential"
    );
}

#[tokio::test]
async fn exact_cas_auth_namespace_and_outage_errors_are_distinct_and_redacted() {
    let server = MockServer::start().await;
    let client = OpenBaoClient::new(&server.uri()).expect("client");
    let session = Session {
        token: SecretString::new("synthetic-token".into()),
        namespace: Some("team-fixture".into()),
        lease: Duration::from_secs(60),
    };
    for (status, message, cause) in [
        (
            400,
            "check-and-set parameter did not match the current version",
            Cause::CasMismatch,
        ),
        (400, "synthetic-provider-secret", Cause::Rejected),
        (403, "synthetic-provider-secret", Cause::Authentication),
        (404, "namespace not found", Cause::Namespace),
        (404, "synthetic-provider-secret", Cause::NotFound),
        (429, "synthetic-provider-secret", Cause::Unavailable),
        (503, "synthetic-provider-secret", Cause::Unavailable),
    ] {
        Mock::given(method("POST"))
            .and(path("/v1/passwords/data/item"))
            .respond_with(
                ResponseTemplate::new(status)
                    .set_body_json(serde_json::json!({"errors":[message]})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let error = client
            .write(
                &session,
                "item",
                0,
                &serde_json::json!({"password":"synthetic-password"}),
                None,
            )
            .await
            .expect_err("error");
        assert_eq!(error.cause(), cause);
        assert_eq!(error.status(), Some(status));
        assert_eq!(error.provider_messages()[0].expose(), message);
        assert!(!format!("{error:?} {error}").contains(message));
        assert!(std::error::Error::source(&error).is_none());
        server.verify().await;
        server.reset().await;
    }
    Mock::given(method("GET"))
        .and(path("/v1/passwords/data/destroyed"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(serde_json::json!({"data":{"data":null}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let error = client
        .read::<serde_json::Value>(&session, "destroyed", Some(1), None)
        .await
        .expect_err("destroyed");
    assert_eq!(error.cause(), Cause::NotFound);
}

#[tokio::test]
async fn metadata_totp_and_exact_destroy_shapes() {
    let server = MockServer::start().await;
    let client = OpenBaoClient::new(&server.uri()).expect("client");
    let session = Session {
        token: SecretString::new("synthetic-token".into()),
        namespace: Some("team-fixture".into()),
        lease: Duration::from_secs(60),
    };
    Mock::given(method("GET")).and(path("/v1/passwords/metadata/item"))
        .and(header("X-Vault-Namespace","team-fixture"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"current_version":4,"versions":{"1":{"created_time":"2026-01-01T00:00:00Z","deletion_time":"","destroyed":true},"4":{"created_time":"2026-01-02T00:00:00Z","deletion_time":"","destroyed":false}}}})))
        .expect(1).mount(&server).await;
    let metadata = client
        .metadata(&session, "item", None)
        .await
        .expect("metadata");
    assert_eq!(metadata.current_version, 4);
    assert!(metadata.versions["1"].destroyed);
    assert!(!metadata.versions["4"].destroyed);
    Mock::given(method("POST"))
        .and(path("/v1/passwords/destroy/item"))
        .and(body_json(serde_json::json!({"versions":[1,4,5]})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    client
        .destroy_versions(&session, "item", vec![1, 4, 5], None)
        .await
        .expect("destroy");
    Mock::given(method("POST"))
        .and(path("/v1/totp/keys/enrollment"))
        .and(header("X-Vault-Namespace", "team-fixture"))
        .and(body_json(
            serde_json::json!({"key":"JBSWY3DPEHPK3PXP","period":30,"digits":6,"algorithm":"SHA1"}),
        ))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    client
        .write_totp(
            &session,
            "enrollment",
            &SecretString::new("JBSWY3DPEHPK3PXP".into()),
            None,
        )
        .await
        .expect("import");
    Mock::given(method("GET"))
        .and(path("/v1/totp/code/enrollment"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"code":"123456"}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let code = client
        .totp(&session, "enrollment", None)
        .await
        .expect("code");
    assert_eq!(code.expose(), "123456");
    assert!(!format!("{code:?}").contains("123456"));
    Mock::given(method("DELETE"))
        .and(path("/v1/totp/keys/enrollment"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({"errors":[]})))
        .expect(1)
        .mount(&server)
        .await;
    client
        .delete_totp(&session, "enrollment", None)
        .await
        .expect("idempotent delete");
}

#[tokio::test]
async fn namespace_deletion_requires_parent_lookup_and_never_hides_denial() {
    let server = MockServer::start().await;
    let client = OpenBaoClient::new(&server.uri()).expect("client");
    Mock::given(method("POST"))
        .and(path("/v1/auth/macro-lifecycle/login"))
        .and(body_json(
            serde_json::json!({"jwt":"synthetic-jwt","role":"team-fixture"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"auth":{"client_token":"lifecycle-token","lease_duration":60}}),
        ))
        .expect(1)
        .mount(&server)
        .await;
    let session = client
        .login_lifecycle(
            "team-fixture",
            &SecretString::new("synthetic-jwt".into()),
            None,
        )
        .await
        .expect("login");
    Mock::given(method("DELETE"))
        .and(path("/v1/sys/namespaces/team-fixture"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"data":{"status":"deletion in progress"}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    client
        .delete_namespace(&session, "team-fixture", None)
        .await
        .expect("accepted");
    Mock::given(method("GET")).and(path("/v1/sys/namespaces/team-fixture"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"id":"synthetic-id","path":"team-fixture/","tainted":true,"locked":false}})))
        .expect(1).mount(&server).await;
    assert!(
        client
            .namespace_exists(&session, "team-fixture", None)
            .await
            .expect("still present")
    );
    server.verify().await;
    server.reset().await;
    Mock::given(method("GET"))
        .and(path("/v1/sys/namespaces/team-fixture"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(serde_json::json!({"errors":["permission denied"]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        client
            .namespace_exists(&session, "team-fixture", None)
            .await
            .expect_err("denied")
            .cause(),
        Cause::Authentication
    );
    server.verify().await;
    server.reset().await;
    Mock::given(method("GET"))
        .and(path("/v1/sys/namespaces/team-fixture"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({"errors":[]})))
        .expect(1)
        .mount(&server)
        .await;
    assert!(
        !client
            .namespace_exists(&session, "team-fixture", None)
            .await
            .expect("erased")
    );
    for request in server.received_requests().await.expect("requests") {
        assert!(!request.headers.contains_key("X-Vault-Namespace"));
        assert_eq!(request.headers["X-Vault-Token"], "lifecycle-token");
    }
}

#[tokio::test]
async fn malformed_response_and_redirect_never_expose_body_or_follow_credentials() {
    let server = MockServer::start().await;
    let target = MockServer::start().await;
    let client = OpenBaoClient::new(&server.uri()).expect("client");
    let session = Session {
        token: SecretString::new("synthetic-token".into()),
        namespace: Some("team-fixture".into()),
        lease: Duration::from_secs(60),
    };
    Mock::given(method("GET"))
        .and(path("/v1/totp/code/broken"))
        .respond_with(ResponseTemplate::new(200).set_body_string("synthetic-plaintext-secret"))
        .expect(1)
        .mount(&server)
        .await;
    let error = client
        .totp(&session, "broken", None)
        .await
        .expect_err("invalid shape");
    assert_eq!(error.cause(), Cause::InvalidResponse);
    assert!(!format!("{error:?} {error}").contains("synthetic-plaintext-secret"));
    Mock::given(method("GET"))
        .and(path("/v1/totp/code/redirect"))
        .respond_with(
            ResponseTemplate::new(307)
                .insert_header("Location", format!("{}/stolen", target.uri())),
        )
        .expect(1)
        .mount(&server)
        .await;
    assert!(client.totp(&session, "redirect", None).await.is_err());
    assert!(
        target
            .received_requests()
            .await
            .expect("requests")
            .is_empty()
    );
}

#[tokio::test]
async fn cancellation_after_remote_acceptance_never_retries_the_write() {
    use axum::{Router, routing::post};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let accepted = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let count = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let route = {
        let accepted = accepted.clone();
        let release = release.clone();
        let count = count.clone();
        post(move || {
            let accepted = accepted.clone();
            let release = release.clone();
            let count = count.clone();
            async move {
                // The synthetic server has committed before its response is lost.
                count.fetch_add(1, Ordering::SeqCst);
                accepted.notify_one();
                release.notified().await;
                axum::Json(
                    serde_json::json!({"data":{"version":1,"created_time":"2026-01-01T00:00:00Z"}}),
                )
            }
        })
    };
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/v1/passwords/data/item", route),
        )
        .await
        .expect("server")
    });
    let client = OpenBaoClient::new(&format!("http://{address}")).expect("client");
    let session = Session {
        token: SecretString::new("synthetic-token".into()),
        namespace: Some("team-fixture".into()),
        lease: Duration::from_secs(60),
    };
    let task = tokio::spawn(async move {
        client
            .write(
                &session,
                "item",
                0,
                &serde_json::json!({"password":"synthetic-password"}),
                None,
            )
            .await
    });
    accepted.notified().await;
    task.abort();
    assert!(task.await.expect_err("cancelled").is_cancelled());
    release.notify_one();
    assert_eq!(count.load(Ordering::SeqCst), 1);
    server.abort();
    let _ = server.await;
}

#[tokio::test]
#[ignore = "requires explicit disposable local OpenBao 2.7.2 and synthetic namespace/signing key"]
#[expect(
    clippy::disallowed_methods,
    reason = "disposable fixture requires explicit process environment and must never inherit APP_SECRETS_JSON"
)]
async fn disposable_provider_cas_history_totp_and_namespace_scope() {
    use jsonwebtoken::{Algorithm, EncodingKey, Header};
    let address = std::env::var("PASSWORDS_TEST_OPENBAO_ADDRESS").expect("disposable address");
    let origin = reqwest::Url::parse(&address).expect("local origin");
    assert_eq!(origin.scheme(), "http");
    assert!(
        matches!(origin.host_str(), Some("127.0.0.1" | "localhost" | "::1")),
        "fixture must use a loopback server"
    );
    let signing_path =
        std::env::var("PASSWORDS_TEST_OPENBAO_SIGNING_KEY").expect("synthetic signing key");
    let team =
        std::env::var("PASSWORDS_TEST_OPENBAO_TEAM").expect("bootstrapped synthetic team UUID");
    let now = chrono::Utc::now().timestamp();
    let claims = serde_json::json!({"iss":"macro-local-passwords","sub":"macro-passwords-service","aud":"macro-passwords","team_id":team,"iat":now,"exp":now+60,"audit_id":"synthetic-client-fixture"});
    let key =
        EncodingKey::from_rsa_pem(&std::fs::read(signing_path).expect("key")).expect("RSA key");
    let jwt = SecretString::new(
        jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &key).expect("JWT"),
    );
    let client = OpenBaoClient::new(&address).expect("client");
    let session = client
        .login_team(
            &format!("team-{team}"),
            "passwords-service",
            &jwt,
            Some("synthetic-client-fixture"),
        )
        .await
        .expect("login");
    let path = format!("client-fixture-{}", std::process::id());
    let first = serde_json::json!({"password":"synthetic-first","operation_id":"first"});
    assert_eq!(
        client
            .write(&session, &path, 0, &first, None)
            .await
            .expect("write"),
        1
    );
    assert_eq!(
        client
            .write(&session, &path, 0, &first, None)
            .await
            .expect_err("CAS mismatch")
            .cause(),
        Cause::CasMismatch
    );
    assert_eq!(
        client
            .write(
                &session,
                &path,
                1,
                &serde_json::json!({"password":"synthetic-second","operation_id":"second"}),
                None
            )
            .await
            .expect("second write"),
        2
    );
    let stored: serde_json::Value = client
        .read(&session, &path, Some(1), None)
        .await
        .expect("historical read");
    assert_eq!(stored, first);
    let metadata = client
        .metadata(&session, &path, None)
        .await
        .expect("metadata");
    assert_eq!(metadata.current_version, 2);
    assert_eq!(metadata.versions.len(), 2);
    client
        .write_totp(
            &session,
            &path,
            &SecretString::new("JBSWY3DPEHPK3PXP".into()),
            None,
        )
        .await
        .expect("seed");
    let code = client.totp(&session, &path, None).await.expect("code");
    assert_eq!(code.expose().len(), 6);
    assert!(code.expose().bytes().all(|byte| byte.is_ascii_digit()));
    client
        .delete_totp(&session, &path, None)
        .await
        .expect("erase seed");
    client
        .delete_totp(&session, &path, None)
        .await
        .expect("repeat erase");
    assert_eq!(
        client
            .totp(&session, &path, None)
            .await
            .expect_err("missing code")
            .cause(),
        Cause::NotFound
    );
    client
        .destroy_versions(&session, &path, vec![1, 2], None)
        .await
        .expect("destroy values");
    assert_eq!(
        client
            .read::<serde_json::Value>(&session, &path, Some(1), None)
            .await
            .expect_err("destroyed")
            .cause(),
        Cause::NotFound
    );
    assert_eq!(
        client
            .metadata(&session, &path, None)
            .await
            .expect("fence retained")
            .current_version,
        2
    );
    assert_eq!(
        client
            .login_team("missing-namespace", "passwords-service", &jwt, None)
            .await
            .expect_err("namespace isolation")
            .cause(),
        Cause::Namespace
    );
    assert_eq!(
        client
            .login_lifecycle(&format!("team-{team}"), &jwt, None)
            .await
            .expect_err("wrong audience/subject")
            .cause(),
        Cause::Authentication
    );
}

#[tokio::test]
async fn invalid_sensitive_header_is_rejected_without_request_or_error_leakage() {
    let server = MockServer::start().await;
    let client = OpenBaoClient::new(&server.uri()).expect("client");
    let session = Session {
        token: SecretString::new("synthetic-secret\ninvalid-header".into()),
        namespace: Some("team-fixture".into()),
        lease: Duration::from_secs(60),
    };
    let error = client
        .metadata(&session, "item", None)
        .await
        .expect_err("invalid header");
    assert_eq!(error.cause(), Cause::InvalidInput);
    assert!(!format!("{error:?} {error}").contains("synthetic-secret"));
    assert!(std::error::Error::source(&error).is_none());
    assert!(
        server
            .received_requests()
            .await
            .expect("requests")
            .is_empty()
    );
}

#[tokio::test]
async fn lost_write_response_is_not_retried_and_accepted_operation_can_be_recovered() {
    let server = MockServer::start().await;
    let client = OpenBaoClient::new(&server.uri()).expect("client");
    let session = Session {
        token: SecretString::new("synthetic-token".into()),
        namespace: Some("team-fixture".into()),
        lease: Duration::from_secs(60),
    };
    let accepted =
        serde_json::json!({"operation_id":"accepted-operation","password":"synthetic-password"});
    Mock::given(method("POST"))
        .and(path("/v1/passwords/data/item"))
        .and(body_json(
            serde_json::json!({"data":accepted,"options":{"cas":0}}),
        ))
        // The operation committed, but its successful response body was lost.
        .respond_with(ResponseTemplate::new(200).set_body_string(""))
        .expect(1)
        .mount(&server)
        .await;
    let error = client
        .write(&session, "item", 0, &accepted, None)
        .await
        .expect_err("lost response");
    assert_eq!(error.cause(), Cause::InvalidResponse);
    Mock::given(method("GET")).and(path("/v1/passwords/metadata/item"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"current_version":1,"versions":{"1":{"created_time":"2026-01-01T00:00:00Z","deletion_time":"","destroyed":false}}}})))
        .expect(1).mount(&server).await;
    Mock::given(method("GET")).and(path("/v1/passwords/data/item")).and(query_param("version","1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":{"data":accepted,"metadata":{"created_time":"2026-01-01T00:00:00Z","deletion_time":"","destroyed":false,"version":1}}})))
        .expect(1).mount(&server).await;
    let version = client
        .metadata(&session, "item", None)
        .await
        .expect("observed version")
        .current_version;
    let recovered: serde_json::Value = client
        .read(&session, "item", Some(version), None)
        .await
        .expect("accepted payload");
    assert_eq!(version, 1);
    assert_eq!(recovered["operation_id"], "accepted-operation");
    assert_eq!(
        server
            .received_requests()
            .await
            .expect("requests")
            .iter()
            .filter(|request| request.method.as_str() == "POST")
            .count(),
        1
    );
}

#[tokio::test]
async fn totp_missing_key_uses_exact_operation_specific_400_cause() {
    let server = MockServer::start().await;
    let client = OpenBaoClient::new(&server.uri()).expect("client");
    let session = Session {
        token: SecretString::new("synthetic-token".into()),
        namespace: Some("team-fixture".into()),
        lease: Duration::from_secs(60),
    };
    for (name, message, cause) in [
        ("missing", "unknown key: missing", Cause::NotFound),
        ("other", "unknown key: unrelated", Cause::Rejected),
    ] {
        Mock::given(method("GET"))
            .and(path(format!("/v1/totp/code/{name}")))
            .respond_with(
                ResponseTemplate::new(400).set_body_json(serde_json::json!({"errors":[message]})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let error = client
            .totp(&session, name, None)
            .await
            .expect_err("missing key");
        assert_eq!(error.cause(), cause);
        assert_eq!(error.status(), Some(400));
        assert_eq!(error.provider_messages()[0].expose(), message);
    }
}
