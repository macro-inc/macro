use std::net::Ipv4Addr;

use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use macro_auth::middleware::decode_jwt::{JwtValidationArgs, MacroAccessToken};
use tokio::{net::TcpListener, sync::oneshot};

use super::{
    super::{
        signed::{Activity, BrainRead, SignedScope},
        signed_inbound,
    },
    *,
};

fn session_token(user: &str, secret: &[u8]) -> String {
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("fusionauth".to_owned());
    encode(
        &header,
        &MacroAccessToken {
            aud: String::new(),
            exp: usize::try_from(Utc::now().timestamp() + 300).unwrap(),
            tid: "local-fixture".to_owned(),
            iss: String::new(),
            email: user.strip_prefix("macro|").unwrap().to_owned(),
            fusion_user_id: Uuid::now_v7().to_string(),
            macro_user_id: user.to_owned(),
            macro_organization_id: None,
            root_macro_id: None,
        },
        &EncodingKey::from_secret(secret),
    )
    .unwrap()
}

async fn account_key(pool: &PgPool, account: &str) -> Uuid {
    sqlx::query_scalar!(r#"SELECT macro_user_id FROM "User" WHERE id = $1"#, account)
        .fetch_one(pool)
        .await
        .unwrap()
}

struct LoopbackClient {
    address: std::net::SocketAddr,
    client: reqwest::Client,
}

impl LoopbackClient {
    async fn read(&self, team: Uuid, agent: &str, token: Option<&str>) -> (StatusCode, Vec<u8>) {
        let mut request = self
            .client
            .get(format!(
                "http://{}/teams/{team}/agents/{agent}/brain/read",
                self.address
            ))
            .header("x-viewer-id", OWNER);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.unwrap();
        assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
        let status = response.status();
        (status, response.bytes().await.unwrap().to_vec())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn signed_loopback_reads_opaque_agent_and_live_document_scope(pool: PgPool) {
    seed_user(&pool, OWNER).await;
    seed_user(&pool, MEMBER).await;
    seed_user(&pool, FOREIGN_OWNER).await;

    let team = seed_team(&pool, OWNER).await;
    let foreign_team = seed_team(&pool, FOREIGN_OWNER).await;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
        team,
        MEMBER,
    )
    .execute(&pool)
    .await
    .unwrap();

    let agents = PgTeamAgentsRepo::new(pool.clone());
    seed_agent(&pool, &agents, team, AGENT, OWNER).await;
    seed_agent(&pool, &agents, team, OTHER_AGENT, OWNER).await;
    seed_agent(&pool, &agents, foreign_team, FOREIGN_AGENT, FOREIGN_OWNER).await;
    let viewer = account_key(&pool, OWNER).await;
    let agent = account_key(&pool, AGENT).await;
    let agent_path = agent.to_string();
    let empty_agent = account_key(&pool, OTHER_AGENT).await.to_string();
    let foreign_agent = account_key(&pool, FOREIGN_AGENT).await.to_string();

    let visible_doc = seed_document(&pool, MEMBER).await;
    let denied_doc = seed_document(&pool, MEMBER).await;
    let channel = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'private', $2)",
        channel,
        MEMBER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member')",
        channel,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
         VALUES ($1, 'document', $2, 'channel', 'view')",
        visible_doc,
        channel.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let journal = Journal::default();
    let completed_at = Utc::now();
    let event = Uuid::now_v7();
    for (source_event, id) in [(event, visible_doc), (Uuid::now_v7(), denied_doc)] {
        journal
            .observe(
                scope(team, AGENT),
                CompletedWork {
                    source_event,
                    source: Source::Document { id },
                    completed_at,
                },
            )
            .unwrap();
    }

    let app = signed_inbound::router(
        PgAuthority::new(pool.clone()),
        team,
        JwtValidationArgs::new_testing(),
        Some((scope(team, AGENT), journal)),
    );

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let http = LoopbackClient {
        address: listener.local_addr().unwrap(),
        client: reqwest::Client::builder().no_proxy().build().unwrap(),
    };
    let (stop, shutdown) = oneshot::channel();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown.await;
            })
            .await
            .unwrap();
    });

    let owner = session_token(OWNER, b"");
    let member = session_token(MEMBER, b"");
    let foreign = session_token(FOREIGN_OWNER, b"");
    let forged = session_token(OWNER, b"wrong-test-key");
    for token in [None, Some(forged.as_str())] {
        assert_eq!(
            http.read(team, &agent_path, token).await,
            (StatusCode::UNAUTHORIZED, Vec::new())
        );
    }

    let (status, body) = http.read(team, &agent_path, Some(&owner)).await;
    assert_eq!(status, StatusCode::OK);
    let read: BrainRead = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        read.scope,
        SignedScope {
            viewer,
            team,
            agent
        }
    );
    assert_eq!(read.profile.name, "Journal fixture");
    assert_eq!(
        read.journal,
        Activity::Ready {
            completed: vec![JournalEntry {
                id: event,
                source: Source::Document { id: visible_doc },
                completed_at,
            }],
        }
    );

    let (status, body) = http.read(team, &empty_agent, Some(&owner)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<BrainRead>(&body).unwrap().journal,
        Activity::Unavailable,
    );

    let missing = Uuid::now_v7().to_string();
    let raw_account = AGENT.replace('|', "%7C").replace('@', "%40");
    let invalid_utf8 = "%FF".to_owned();
    let noncanonical = agent_path.replacen('-', "%2D", 1);
    for (team, key, token) in [
        (team, &agent_path, &member),
        (foreign_team, &agent_path, &owner),
        (team, &foreign_agent, &owner),
        (foreign_team, &agent_path, &foreign),
        (team, &missing, &owner),
        (team, &noncanonical, &owner),
        (team, &raw_account, &owner),
        (team, &invalid_utf8, &owner),
    ] {
        assert_eq!(
            http.read(team, key, Some(token)).await,
            (StatusCode::NOT_FOUND, Vec::new())
        );
    }

    let unconfigured = signed_inbound::router(
        PgAuthority::new(pool.clone()),
        team,
        JwtValidationArgs::new_testing(),
        None,
    );
    let request = Request::builder()
        .uri(format!("/teams/{team}/agents/{agent_path}/brain/read"))
        .header("authorization", format!("Bearer {owner}"))
        .body(Body::empty())
        .unwrap();
    let response = unconfigured.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let read: BrainRead = serde_json::from_slice(&body).unwrap();
    assert_eq!(read.journal, Activity::Unavailable);

    let member_key = account_key(&pool, MEMBER).await;
    for (key, expected) in [(agent, StatusCode::NOT_FOUND), (member_key, StatusCode::OK)] {
        sqlx::query!(
            r#"UPDATE "User" SET macro_user_id = $1 WHERE id = $2"#,
            key,
            MEMBER
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(http.read(team, &agent_path, Some(&owner)).await.0, expected);
    }

    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2",
        channel,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    let (status, body) = http.read(team, &agent_path, Some(&owner)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<BrainRead>(&body).unwrap().journal,
        Activity::Ready {
            completed: Vec::new()
        },
    );
    assert_eq!(
        http.read(foreign_team, &agent_path, Some(&owner)).await,
        (StatusCode::NOT_FOUND, Vec::new())
    );

    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        AGENT,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        http.read(team, &agent_path, Some(&owner)).await,
        (StatusCode::NOT_FOUND, Vec::new())
    );
    stop.send(()).unwrap();
    server.await.unwrap();
}
