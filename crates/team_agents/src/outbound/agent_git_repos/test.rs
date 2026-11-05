use super::*;

#[tokio::test]
async fn advertised_clone_url_uses_the_computer_base_and_preserves_the_repo_token() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = axum::Router::new().route(
        "/internal/repos",
        axum::routing::post(|| async {
            axum::Json(agent_git::api::CreatedRepoResponse {
                agent_user_id: MacroUserIdStr::parse_from_str("macro|brain@example.com")
                    .unwrap()
                    .into_owned(),
                token: "repo-bootstrap-token".into(),
                clone_url: "http://agent-git-service:8080/host-only.git".into(),
            })
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let adapter = AgentGitRepos::new(
        AgentGitClient::new(format!("http://{address}"), "internal-key".into()).unwrap(),
        "http://10.210.0.1:22413/git/".into(),
    );
    let repo = adapter
        .create(
            &MacroUserIdStr::parse_from_str("macro|brain@example.com").unwrap(),
            Uuid::from_u128(1),
            &PersonaSeed {
                creator_id: Some("macro|admin@example.com".to_string()),
                name: "Brain".into(),
                job_description: "Help".into(),
                personality: "Careful".into(),
            },
        )
        .await
        .unwrap();
    let url = reqwest::Url::parse(&repo.url).unwrap();
    assert_eq!(url.host_str(), Some("10.210.0.1"));
    assert_eq!(url.port(), Some(22413));
    assert!(url.path().starts_with("/git/"));
    assert_eq!(url.path_segments().unwrap().count(), 2);
    assert!(url.path().ends_with(".git"));
    assert_eq!(repo.token.expose(), "repo-bootstrap-token");
    server.abort();
}
