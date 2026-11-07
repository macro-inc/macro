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
                token: agent_credentials::RepoToken::parse(format!("mrt_{}", "b".repeat(64)))
                    .expect("test token"),
                clone_url: "http://agent-git-service:8080/host-only.git".into(),
            })
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let base = Arc::new(std::sync::Mutex::new(AgentGitServiceUrl::from_static(
        "http://10.210.0.1:22413/git/",
    )));
    let current = base.clone();
    let adapter = AgentGitRepos {
        client: AgentGitClient::new(format!("http://{address}"), "internal-key".into()).unwrap(),
        clone_base_url: Arc::new(move || {
            Ok(AgentGitServiceUrl::from_owned(
                current.lock().unwrap().as_str(),
            ))
        }),
    };
    let repo = adapter
        .create(
            &MacroUserIdStr::parse_from_str("macro|brain@example.com").unwrap(),
            Uuid::from_u128(1),
            &PersonaSeed {
                voice: None,
                creator_id: Some(
                    macro_user_id::user_id::MacroUserIdStr::parse_from_str(
                        "macro|admin@example.com",
                    )
                    .expect("admin id")
                    .into_owned(),
                ),
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
    assert_eq!(
        repo.token.hash(),
        agent_credentials::RepoToken::parse(format!("mrt_{}", "b".repeat(64)))
            .expect("expected token")
            .hash()
    );
    *base.lock().unwrap() =
        AgentGitServiceUrl::from_static("https://changed-git.example.com/recreated/");
    let recreated = adapter
        .create(
            &MacroUserIdStr::parse_from_str("macro|brain@example.com").unwrap(),
            Uuid::from_u128(1),
            &PersonaSeed {
                voice: None,
                creator_id: None,
                name: "Brain".into(),
                job_description: "Help".into(),
                personality: "Careful".into(),
            },
        )
        .await
        .unwrap();
    let recreated = reqwest::Url::parse(&recreated.url).unwrap();
    assert_eq!(recreated.host_str(), Some("changed-git.example.com"));
    assert!(recreated.path().starts_with("/recreated/"));
    assert!(recreated.path().ends_with(".git"));
    server.abort();
}

#[tokio::test]
async fn missing_git_returns_a_safe_pre_purchase_failure_reason() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = axum::Router::new().route(
        "/internal/repos",
        axum::routing::post(|| async {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "run git init: No such file or directory (os error 2)",
            )
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let adapter = AgentGitRepos {
        client: AgentGitClient::new(format!("http://{address}"), "internal-key".into()).unwrap(),
        clone_base_url: Arc::new(|| Ok(AgentGitServiceUrl::from_static("http://git.example.com"))),
    };
    let error = adapter
        .create(
            &MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap(),
            Uuid::from_u128(1),
            &PersonaSeed {
                voice: None,
                creator_id: None,
                name: "Agent".into(),
                job_description: "Help".into(),
                personality: "Direct".into(),
            },
        )
        .await
        .expect_err("git failed before a computer purchase");
    assert!(matches!(error, TeamAgentError::InvitationFailed(_)));
    assert!(error.to_string().contains("missing git"));
    assert!(error.to_string().contains("Nothing was charged"));
    server.abort();
}
