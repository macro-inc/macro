use crate::{FusionAuthClient, error::FusionAuthClientError};
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path, query_param},
};

fn client(base_url: String) -> FusionAuthClient {
    FusionAuthClient::new(
        "api-key".into(),
        "application-id".into(),
        "client-secret".into(),
        base_url,
        "http://localhost/callback".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
}

#[tokio::test]
async fn grant_requests_time_out_when_the_provider_stops_responding() {
    use tokio::io::AsyncReadExt;

    for method in ["GET", "POST", "DELETE"] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (accepted, received) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut byte = [0];
            stream.read_exact(&mut byte).await.unwrap();
            accepted.send(()).unwrap();
            // Keep the connection open without returning an HTTP response.
            std::future::pending::<()>().await;
            drop(stream);
        });
        let client = client(format!("http://{address}"));
        let mut request = tokio::spawn(async move {
            match method {
                "GET" => client
                    .get_links("identity", Some("github".into()))
                    .await
                    .map(|_| ()),
                "DELETE" => client.unlink_user("identity", "github", "1").await,
                _ => {
                    client
                        .link_user(super::LinkUserRequest {
                            identity_provider_link: super::IdentityProviderLink {
                                display_name: "octocat".into(),
                                identity_provider_id: "github".into(),
                                identity_provider_user_id: "1".into(),
                                user_id: "identity".into(),
                                token: "token".into(),
                            },
                        })
                        .await
                }
            }
        });
        received.await.unwrap();
        tokio::time::pause();
        tokio::time::advance(super::LINK_REQUEST_TIMEOUT + std::time::Duration::from_secs(1)).await;
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), &mut request).await;
        tokio::time::resume();
        server.abort();
        request.abort();
        assert!(
            matches!(result, Ok(Ok(Err(FusionAuthClientError::Generic(_))))),
            "{method} must time out as an infrastructure error: {result:?}"
        );
    }
}

#[tokio::test]
async fn deleted_identity_is_typed_for_lookup_and_disconnect() {
    let server = MockServer::start().await;
    for verb in ["GET", "DELETE"] {
        Mock::given(method(verb)).and(path("/api/identity-provider/link"))
            .and(query_param("userId", "fd3a2d52-7168-4810-96ff-8f793e0813cb"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({
                "fieldErrors": { "userId": [{ "code": "[invalid]userId", "message": "No user exists with this Id" }] },
                "generalErrors": []
            })))
            .expect(1).mount(&server).await;
    }
    let client = client(server.uri());
    assert!(matches!(
        client
            .get_links(
                "fd3a2d52-7168-4810-96ff-8f793e0813cb",
                Some("github-idp".into())
            )
            .await,
        Err(FusionAuthClientError::UserDoesNotExist)
    ));
    assert!(matches!(
        client
            .unlink_user("fd3a2d52-7168-4810-96ff-8f793e0813cb", "github-idp", "1")
            .await,
        Err(FusionAuthClientError::UserDoesNotExist)
    ));
}

#[tokio::test]
async fn other_failures_are_not_misclassified_as_deleted_users() {
    for (status, body) in [
        (400, json!({ "fieldErrors": { "identityProviderId": [{ "code": "[invalid]identityProviderId" }] } }).to_string()),
        (400, "invalid JSON".into()),
        (401, String::new()),
        (500, json!({ "fieldErrors": { "userId": [{ "code": "[invalid]userId" }] } }).to_string()),
    ] {
        let server = MockServer::start().await;
        Mock::given(path("/api/identity-provider/link"))
            .respond_with(ResponseTemplate::new(status).set_body_string(body))
            .expect(2).mount(&server).await;
        let client = client(server.uri());
        assert!(matches!(client.get_links("user", Some("idp".into())).await, Err(FusionAuthClientError::Generic(_))));
        assert!(matches!(client.unlink_user("user", "idp", "1").await, Err(FusionAuthClientError::Generic(_))));
    }
}

#[tokio::test]
async fn absent_link_and_empty_links_are_distinct_from_infrastructure_errors() {
    let server = MockServer::start().await;
    Mock::given(query_param("userId", "absent"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(query_param("userId", "empty"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "identityProviderLinks": [] })),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = client(server.uri());
    assert!(matches!(
        client.get_links("absent", Some("idp".into())).await,
        Err(FusionAuthClientError::NoIdentityProviderFound)
    ));
    assert!(
        client
            .get_links("empty", Some("idp".into()))
            .await
            .unwrap()
            .is_empty()
    );
}
