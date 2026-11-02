use super::*;
use crate::domain::Repository as _;
use crate::test_support::TestDatabase;
use axum::{body::Body, http::Request};
use http_body_util::BodyExt as _;
use tower::ServiceExt as _;

fn test_router(apps: &'static [App]) -> Router {
    test_router_with_url(apps, "http://localhost:8080")
}

fn test_router_with_url(apps: &'static [App], public_url: &str) -> Router {
    use crate::outbound::{EnvelopeCipher, LocalKeyWrapper, PostgresRepository};
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/connect_test")
        .unwrap();
    let wrapper = Arc::new(LocalKeyWrapper::from_base64(&STANDARD.encode([7_u8; 32])).unwrap());
    let repository = Arc::new(PostgresRepository::new(pool));
    let cipher = Arc::new(EnvelopeCipher::new(wrapper));
    let service = Arc::new(Service::new(repository.clone()));
    let oauth = Arc::new(domain::oauth::OAuthService::new(
        repository,
        cipher,
        Arc::new(outbound::oauth::VendorOAuth::new().unwrap()),
        apps,
        url::Url::parse(public_url).unwrap(),
        HashMap::new(),
    ));
    router(AppState {
        apps,
        service,
        oauth,
        mcp_http: crate::outbound::mcp::VendorMcp::new().unwrap(),
    })
}

#[test]
fn only_live_own_apps_require_credentials() {
    let apps = all_apps().unwrap();
    assert!(load_own_apps(apps, |_| None).unwrap().is_empty());

    let mut github = apps
        .iter()
        .find(|app| app.id.as_str() == "github")
        .unwrap()
        .clone();
    github.status = Status::Live;
    let live = [github];
    assert!(load_own_apps(&live, |_| None).is_err());
    assert!(
        load_own_apps(&live, |key| {
            (key == "GITHUB_CLIENT_ID").then(|| "client".to_owned())
        })
        .is_err()
    );
    let clients = load_own_apps(&live, |key| match key {
        "GITHUB_CLIENT_ID" => Some("client".to_owned()),
        "GITHUB_CLIENT_SECRET" => Some("secret".to_owned()),
        _ => None,
    })
    .unwrap();
    assert_eq!(clients.len(), 1);
    assert!(clients.contains_key("github"));
}

#[test]
fn public_url_requires_host_root() {
    assert!(parse_public_url("https://connect-dev.macro.com").is_ok());
    assert!(parse_public_url("http://localhost:8080").is_ok());
    assert!(parse_public_url("https://connect-dev.macro.com/connect").is_err());
    assert!(parse_public_url("https://connect-dev.macro.com?bad=1").is_err());
}

#[tokio::test]
async fn root_serves_health() {
    let response = test_router(all_apps().unwrap())
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn catalog_icon_url_uses_root() {
    let response = test_router_with_url(all_apps().unwrap(), "http://localhost:8080")
        .oneshot(
            Request::builder()
                .uri("/v1/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    let notion = entries
        .iter()
        .find(|entry| entry["id"] == "notion")
        .unwrap();
    assert_eq!(notion["icon_url"], "/v1/catalog/notion/icon.svg");
}

#[tokio::test]
async fn catalog_only_exposes_live_apps_with_public_fields() {
    let apps = all_apps().unwrap();
    let response = test_router(apps)
        .oneshot(
            Request::builder()
                .uri("/v1/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    let live_count = apps.iter().filter(|app| app.status == Status::Live).count();
    assert_eq!(entries.len(), live_count);
    for entry in &entries {
        let id = entry["id"].as_str().unwrap();
        let app = apps.iter().find(|app| app.id.as_str() == id).unwrap();
        assert_eq!(app.status, Status::Live);
        assert_eq!(entry["name"], app.name);
        assert_eq!(entry["description"], app.description);
        assert!(entry["access"].is_array());
        assert_eq!(
            entry["oauth_client"],
            match app.client_registration {
                ClientRegistration::OwnApp => serde_json::json!("managed_oauth_app"),
                ClientRegistration::Cimd | ClientRegistration::Dcr => serde_json::json!("dcr"),
                ClientRegistration::ApiKey => serde_json::Value::Null,
            }
        );
        assert_eq!(entry["mcp_url"], app.mcp_url);
        if app.icon_svg.is_some() {
            assert_eq!(entry["icon_url"], format!("/v1/catalog/{id}/icon.svg"));
        } else {
            assert!(entry["icon_url"].is_null());
        }
        assert_eq!(
            entry.as_object().unwrap().len(),
            if app.client_registration == ClientRegistration::ApiKey {
                6
            } else {
                7
            }
        );
    }
}

#[tokio::test]
async fn catalog_labels_managed_oauth_and_omits_api_key_label() {
    let apps = all_apps().unwrap();
    let mut managed = apps
        .iter()
        .find(|app| app.id.as_str() == "github")
        .unwrap()
        .clone();
    managed.status = Status::Live;
    let mut api_key = managed.clone();
    api_key.id = connect_registry::AppId::parse("api-key-example").unwrap();
    api_key.client_registration = ClientRegistration::ApiKey;
    let fixtures = Box::leak(vec![managed, api_key].into_boxed_slice());
    let response = test_router(fixtures)
        .oneshot(
            Request::builder()
                .uri("/v1/catalog")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert_eq!(entries[0]["oauth_client"], "managed_oauth_app");
    assert!(entries[1].get("oauth_client").is_none());
}

#[tokio::test]
async fn icon_route_returns_embedded_svg_and_404_for_unknown_id() {
    let apps = all_apps().unwrap();
    let response = test_router(apps)
        .oneshot(
            Request::builder()
                .uri("/v1/catalog/notion/icon.svg")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/svg+xml");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let notion = apps.iter().find(|app| app.id.as_str() == "notion").unwrap();
    assert_eq!(bytes.as_ref(), notion.icon_svg.unwrap().as_bytes());

    let response = test_router(apps)
        .oneshot(
            Request::builder()
                .uri("/v1/catalog/unknown/icon.svg")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn openapi_route_describes_catalog() {
    let response = test_router(all_apps().unwrap())
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let schema: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(schema["paths"]["/v1/catalog"]["get"].is_object());
    assert!(schema["paths"]["/v1/users/{external_user_id}/connections"]["get"].is_object());
    assert!(
        schema["paths"]["/v1/users/{external_user_id}/connections/{app_id}"]["delete"].is_object()
    );
    assert!(
        schema["paths"]["/v1/users/{external_user_id}/connections/{app_id}/token"]["get"]
            .is_object()
    );
    for method in ["post", "get", "delete"] {
        assert!(schema["paths"]["/v1/users/{external_user_id}/mcp/{app_id}"][method].is_object());
        assert_eq!(
            schema["paths"]["/v1/users/{external_user_id}/mcp/{app_id}"][method]["security"][0]["customer_key"],
            serde_json::json!([])
        );
    }
    let icon_schema = &schema["components"]["schemas"]["CatalogEntry"]["properties"]["icon_url"];
    assert!(
        icon_schema["type"]
            .as_array()
            .is_some_and(|types| types.contains(&serde_json::json!("null"))),
        "{icon_schema}"
    );
    let oauth_schema = &schema["components"]["schemas"]["OAuthClient"];
    assert_eq!(
        oauth_schema["enum"],
        serde_json::json!(["managed_oauth_app", "dcr"])
    );
    assert_eq!(
        schema["components"]["securitySchemes"]["customer_key"]["scheme"],
        "bearer"
    );
    assert_eq!(
        schema["paths"]["/v1/users/{external_user_id}/connections"]["get"]["security"][0]["customer_key"],
        serde_json::json!([])
    );
    for path in ["/v1/connections", "/v1/connections/summary", "/v1/users"] {
        assert_eq!(
            schema["paths"][path]["get"]["security"][0]["customer_key"],
            serde_json::json!([])
        );
    }
}

#[tokio::test]
#[expect(
    clippy::disallowed_methods,
    reason = "Connect database tests use runtime-checked SQLx queries"
)]
async fn customer_connection_listing_is_scoped_ordered_filtered_and_safe() {
    use crate::outbound::{EnvelopeCipher, LocalKeyWrapper, PostgresRepository};
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let database = TestDatabase::new().await;
    let repository = Arc::new(PostgresRepository::new(database.pool().clone()));
    let key = repository.create_customer("one").await.unwrap();
    let other_key = repository.create_customer("two").await.unwrap();
    let customer_id = repository.authenticate(&key).await.unwrap();
    let other_id = repository.authenticate(&other_key).await.unwrap();
    let cipher = Arc::new(EnvelopeCipher::new(Arc::new(
        LocalKeyWrapper::from_base64(&STANDARD.encode([9_u8; 32])).unwrap(),
    )));
    let envelope = domain::Envelope {
        ciphertext: b"private-ciphertext".to_vec(),
        nonce: vec![0; 12],
        encrypted_data_key: b"private-key".to_vec(),
        kms_key_id: "local".into(),
        encryption_version: 1,
        access_token_expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
    };
    for (owner, user, app_id, status, time) in [
        (
            customer_id,
            "old-user",
            "notion",
            "active",
            "2026-10-29T09:00:00Z",
        ),
        (
            customer_id,
            "new-user",
            "linear",
            "needs_reauth",
            "2026-10-30T09:00:00Z",
        ),
        (
            customer_id,
            "new-user",
            "notion",
            "active",
            "2026-10-30T09:00:00Z",
        ),
        (
            other_id,
            "other-user",
            "notion",
            "active",
            "2026-10-31T09:00:00Z",
        ),
    ] {
        let id = uuid::Uuid::now_v7();
        repository
            .insert_connection(id, owner, user, app_id, &["read".into()], &envelope)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE connections SET status = $1, created_at = $2::timestamptz WHERE id = $3",
        )
        .bind(status)
        .bind(time)
        .bind(id)
        .execute(database.pool())
        .await
        .unwrap();
    }
    let apps = all_apps().unwrap();
    let app = router(AppState {
        apps,
        service: Arc::new(Service::new(repository.clone())),
        oauth: Arc::new(domain::oauth::OAuthService::new(
            repository.clone(),
            cipher,
            Arc::new(outbound::oauth::VendorOAuth::new().unwrap()),
            apps,
            url::Url::parse("http://localhost:8080").unwrap(),
            HashMap::new(),
        )),
        mcp_http: outbound::mcp::VendorMcp::new().unwrap(),
    });
    let get = |path: String, key: &str| {
        Request::builder()
            .uri(path)
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .body(Body::empty())
            .unwrap()
    };
    let response = app
        .clone()
        .oneshot(get("/v1/connections?limit=2".into(), &key))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let first: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(), 2);
    assert!(
        first["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["externalUserId"] == "new-user")
    );
    assert_eq!(first["items"][0]["appId"], "notion");
    assert!(first["items"][0]["accessTokenExpiresAt"].is_string());
    let json = first.to_string();
    for secret in [
        "ciphertext",
        "nonce",
        "encrypted",
        "private",
        "\"accessToken\"",
        "refreshToken",
    ] {
        assert!(!json.contains(secret), "leaked {secret}");
    }
    let cursor = first["nextCursor"].as_str().unwrap();
    let mut url = url::Url::parse("http://localhost/v1/connections").unwrap();
    url.query_pairs_mut()
        .append_pair("limit", "2")
        .append_pair("cursor", cursor);
    let second = app
        .clone()
        .oneshot(get(
            format!("{}?{}", url.path(), url.query().unwrap()),
            &key,
        ))
        .await
        .unwrap();
    let second: serde_json::Value =
        serde_json::from_slice(&second.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(second["items"][0]["externalUserId"], "old-user");
    assert!(second["nextCursor"].is_null());
    for (path, expected) in [
        ("/v1/connections?app_id=notion", 2),
        ("/v1/connections?status=needs_reauth", 1),
        ("/v1/connections?app_id=linear&status=active", 0),
    ] {
        let response = app.clone().oneshot(get(path.into(), &key)).await.unwrap();
        let body: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["items"].as_array().unwrap().len(), expected);
    }
    for path in [
        "/v1/connections?cursor=bad",
        "/v1/connections?status=bad",
        "/v1/connections?app_id=%3Cbad%3E",
        "/v1/connections?app_id=-bad",
        "/v1/connections?limit=501",
        "/v1/connections?limit=0",
    ] {
        assert_eq!(
            app.clone()
                .oneshot(get(path.into(), &key))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        app.clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/connections")
                    .body(Body::empty())
                    .unwrap()
            )
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    for (key, users, connections, needs_reauth) in [(&key, 2, 3, 1), (&other_key, 1, 1, 0)] {
        let response = app
            .clone()
            .oneshot(get("/v1/connections/summary".into(), key))
            .await
            .unwrap();
        let summary: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(summary["users"], users);
        assert_eq!(summary["connections"], connections);
        assert_eq!(summary["needsReauth"], needs_reauth);
        let response = app
            .clone()
            .oneshot(get("/v1/connections".into(), key))
            .await
            .unwrap();
        let page: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(page["items"].as_array().unwrap().len(), connections);
    }
    let response = app
        .clone()
        .oneshot(get("/v1/connections/summary".into(), &key))
        .await
        .unwrap();
    let summary: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(summary["apps"].as_array().unwrap().len(), 2);
    assert_eq!(
        summary["apps"]
            .as_array()
            .unwrap()
            .iter()
            .find(|app| app["appId"] == "notion")
            .unwrap()["active"],
        2
    );
    sqlx::query("UPDATE connections SET created_at = '2026-10-20T09:00:00Z' WHERE customer_id = $1 AND external_user_id = 'new-user' AND app_id = 'linear'")
        .bind(customer_id).execute(database.pool()).await.unwrap();
    let first = app
        .clone()
        .oneshot(get("/v1/users?limit=1".into(), &key))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first: serde_json::Value =
        serde_json::from_slice(&first.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(), 1);
    assert_eq!(first["items"][0]["externalUserId"], "old-user");
    let cursor = first["nextCursor"].as_str().unwrap();
    let mut url = url::Url::parse("http://localhost/v1/users").unwrap();
    url.query_pairs_mut()
        .append_pair("limit", "1")
        .append_pair("cursor", cursor);
    let second = app
        .clone()
        .oneshot(get(
            format!("{}?{}", url.path(), url.query().unwrap()),
            &key,
        ))
        .await
        .unwrap();
    let second: serde_json::Value =
        serde_json::from_slice(&second.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(second["items"][0]["externalUserId"], "new-user");
    assert_eq!(
        second["items"][0]["connections"].as_array().unwrap().len(),
        2
    );
    assert_eq!(second["items"][0]["connections"][0]["appId"], "linear");
    assert_eq!(second["items"][0]["connections"][1]["appId"], "notion");
    assert_eq!(
        second["items"][0]["firstConnectedAt"],
        "2026-10-20T09:00:00Z"
    );
    assert!(second["nextCursor"].is_null());
    for secret in [
        "ciphertext",
        "encrypted",
        "private",
        "refreshToken",
        "\"accessToken\"",
    ] {
        assert!(!second.to_string().contains(secret), "leaked {secret}");
    }
    let filtered = app
        .clone()
        .oneshot(get(
            "/v1/users?app_id=linear&status=needs_reauth".into(),
            &key,
        ))
        .await
        .unwrap();
    let filtered: serde_json::Value =
        serde_json::from_slice(&filtered.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(filtered["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        filtered["items"][0]["connections"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for path in [
        "/v1/users?cursor=bad",
        "/v1/users?limit=0",
        "/v1/users?limit=501",
        "/v1/users?status=bad",
        "/v1/users?app_id=-bad",
    ] {
        assert_eq!(
            app.clone()
                .oneshot(get(path.into(), &key))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let other = app
        .clone()
        .oneshot(get("/v1/users".into(), &other_key))
        .await
        .unwrap();
    let other: serde_json::Value =
        serde_json::from_slice(&other.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(other["items"].as_array().unwrap().len(), 1);
    assert_eq!(other["items"][0]["externalUserId"], "other-user");
    sqlx::query("INSERT INTO connections (id, customer_id, external_user_id, app_id, status, scopes, created_at) VALUES ($1, $2, 'z-user', 'linear', 'active', ARRAY[]::text[], '2026-10-29T09:00:00Z')")
        .bind(uuid::Uuid::now_v7()).bind(customer_id).execute(database.pool()).await.unwrap();
    let tied = app
        .clone()
        .oneshot(get("/v1/users?limit=1".into(), &key))
        .await
        .unwrap();
    let tied: serde_json::Value =
        serde_json::from_slice(&tied.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(tied["items"][0]["externalUserId"], "z-user");
    let mut tie_url = url::Url::parse("http://localhost/v1/users").unwrap();
    tie_url
        .query_pairs_mut()
        .append_pair("limit", "1")
        .append_pair("cursor", tied["nextCursor"].as_str().unwrap());
    let after_tie = app
        .clone()
        .oneshot(get(
            format!("{}?{}", tie_url.path(), tie_url.query().unwrap()),
            &key,
        ))
        .await
        .unwrap();
    let after_tie: serde_json::Value =
        serde_json::from_slice(&after_tie.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(after_tie["items"][0]["externalUserId"], "old-user");
    assert_eq!(
        app.oneshot(
            Request::builder()
                .uri("/v1/users")
                .body(Body::empty())
                .unwrap()
        )
        .await
        .unwrap()
        .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
#[expect(
    clippy::disallowed_methods,
    reason = "Connect's test database uses its own runtime migration per connect/docs/decisions.md"
)]
async fn routes_enforce_keys_and_customer_scope() {
    let database = TestDatabase::new().await;
    let pool = database.pool().clone();
    use crate::{
        domain::{Grant, GrantCipher},
        outbound::{EnvelopeCipher, LocalKeyWrapper, PostgresRepository},
    };
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let repository = Arc::new(PostgresRepository::new(pool.clone()));
    let key = repository.create_customer("Macro").await.unwrap();
    let other_key = repository.create_customer("Other").await.unwrap();
    let customer_id = repository.authenticate(&key).await.unwrap();
    let cipher = Arc::new(EnvelopeCipher::new(Arc::new(
        LocalKeyWrapper::from_base64(&STANDARD.encode([8_u8; 32])).unwrap(),
    )));
    let connection_id = uuid::Uuid::now_v7();
    let grant = Grant {
        access_token: "private-access".into(),
        refresh_token: Some("private-refresh".into()),
        token_type: "Bearer".into(),
        expires_at: Some(chrono::Utc::now() + chrono::Duration::hours(1)),
        scopes: vec!["read".into()],
    };
    let envelope = cipher
        .seal(customer_id, connection_id, &grant)
        .await
        .unwrap();
    repository
        .insert_connection(
            connection_id,
            customer_id,
            "user-a",
            "notion",
            &grant.scopes,
            &envelope,
        )
        .await
        .unwrap();
    let app = router(AppState {
        apps: all_apps().unwrap(),
        service: Arc::new(Service::new(repository.clone())),
        oauth: Arc::new(domain::oauth::OAuthService::new(
            repository.clone(),
            cipher,
            Arc::new(outbound::oauth::VendorOAuth::new().unwrap()),
            all_apps().unwrap(),
            url::Url::parse("http://localhost:8080").unwrap(),
            HashMap::new(),
        )),
        mcp_http: crate::outbound::mcp::VendorMcp::new().unwrap(),
    });
    let list = "/v1/users/user-a/connections";
    let request = |uri: &str, key: Option<&str>, method: axum::http::Method| {
        let mut builder = Request::builder().uri(uri).method(method);
        if let Some(key) = key {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {key}"));
        }
        builder.body(Body::empty()).unwrap()
    };
    assert_eq!(
        app.clone()
            .oneshot(request(list, None, axum::http::Method::GET))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.clone()
            .oneshot(request(
                list,
                Some("ck_bad_secret"),
                axum::http::Method::GET
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let revoked_id = uuid::Uuid::parse_str(key.split('_').nth(1).unwrap()).unwrap();
    let wrong_secret = format!("ck_{revoked_id}_wrong-secret");
    assert_eq!(
        app.clone()
            .oneshot(request(list, Some(&wrong_secret), axum::http::Method::GET))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("UPDATE customer_api_keys SET revoked_at = now() WHERE id = $1")
        .bind(revoked_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(request(list, Some(&key), axum::http::Method::GET))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let response = app
        .clone()
        .oneshot(request(list, Some(&other_key), axum::http::Method::GET))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        0
    );
    // The first customer needs another key after revocation.
    let new_key_id = uuid::Uuid::now_v7();
    let secret = "another-key-secret";
    use sha2::Digest as _;
    let hash = sha2::Sha256::digest(secret.as_bytes());
    sqlx::query(
        "INSERT INTO customer_api_keys (id, customer_id, key_hash, prefix) VALUES ($1, $2, $3, $4)",
    )
    .bind(new_key_id)
    .bind(customer_id)
    .bind(&hash[..])
    .bind(&secret[..8])
    .execute(&pool)
    .await
    .unwrap();
    let owner_key = format!("ck_{new_key_id}_{secret}");
    let response = app
        .clone()
        .oneshot(request(list, Some(&owner_key), axum::http::Method::GET))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()[0]["appId"],
        "notion"
    );
    let token_url = "/v1/users/user-a/connections/notion/token";
    let response = app
        .clone()
        .oneshot(request(
            token_url,
            Some(&owner_key),
            axum::http::Method::GET,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["accessToken"],
        "private-access"
    );
    assert_eq!(
        app.clone()
            .oneshot(request(
                token_url,
                Some(&other_key),
                axum::http::Method::GET
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let delete_url = "/v1/users/user-a/connections/notion";
    assert_eq!(
        app.clone()
            .oneshot(request(
                delete_url,
                Some(&other_key),
                axum::http::Method::DELETE
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let response = app
        .clone()
        .oneshot(request(
            delete_url,
            Some(&owner_key),
            axum::http::Method::DELETE,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["vendorGrantRevoked"],
        false
    );
    assert_eq!(
        app.clone()
            .oneshot(request(
                token_url,
                Some(&owner_key),
                axum::http::Method::GET
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn expired_token_requires_reauthorization() {
    let database = TestDatabase::new().await;
    let pool = database.pool().clone();
    use crate::{
        domain::{Grant, GrantCipher},
        outbound::{EnvelopeCipher, LocalKeyWrapper, PostgresRepository},
    };
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let repository = Arc::new(PostgresRepository::new(pool));
    let key = repository.create_customer("Macro").await.unwrap();
    let customer_id = repository.authenticate(&key).await.unwrap();
    let cipher = Arc::new(EnvelopeCipher::new(Arc::new(
        LocalKeyWrapper::from_base64(&STANDARD.encode([8_u8; 32])).unwrap(),
    )));
    let id = uuid::Uuid::now_v7();
    let grant = Grant {
        access_token: "expired".into(),
        refresh_token: None,
        token_type: "Bearer".into(),
        expires_at: Some(chrono::Utc::now() - chrono::Duration::hours(1)),
        scopes: vec![],
    };
    let envelope = cipher.seal(customer_id, id, &grant).await.unwrap();
    repository
        .insert_connection(id, customer_id, "user-a", "notion", &[], &envelope)
        .await
        .unwrap();
    let app = router(AppState {
        apps: all_apps().unwrap(),
        service: Arc::new(Service::new(repository.clone())),
        oauth: Arc::new(domain::oauth::OAuthService::new(
            repository,
            cipher,
            Arc::new(outbound::oauth::VendorOAuth::new().unwrap()),
            all_apps().unwrap(),
            url::Url::parse("http://localhost:8080").unwrap(),
            HashMap::new(),
        )),
        mcp_http: crate::outbound::mcp::VendorMcp::new().unwrap(),
    });
    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/users/user-a/connections/notion/token")
                .header(header::AUTHORIZATION, format!("Bearer {}", key.as_str()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
        "needs_reauth"
    );
}
