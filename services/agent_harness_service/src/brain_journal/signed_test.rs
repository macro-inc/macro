use std::{net::Ipv4Addr, sync::Arc};

use axum::{
    Json, Router,
    extract::{FromRef, OriginalUri, Path, RawQuery, State, rejection::PathRejection},
    response::{IntoResponse, Response},
    routing::get,
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use macro_auth::middleware::decode_jwt::{JwtValidationArgs, MacroAccessToken};
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationExtractor,
    MacroAuthorizationRejection, MacroAuthorizationServiceImpl, MacroAuthorizationState,
    NoBotAuthorizer, NoUserApiKeyAuthorizer, UserOnly,
};
use tokio::{net::TcpListener, sync::oneshot};

use super::*;

type Authorization = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

#[derive(Clone)]
struct SignedState {
    service: Arc<SignedRead>,
    authorization: MacroAuthorizationState<Authorization>,
}

impl FromRef<SignedState> for MacroAuthorizationState<Authorization> {
    fn from_ref(state: &SignedState) -> Self {
        state.authorization.clone()
    }
}

struct SignedRead {
    authority: PgAuthority,
    journal: Journal,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct SignedScope {
    viewer: Uuid,
    team: Uuid,
    agent: Uuid,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct SignedJournal {
    scope: SignedScope,
    completed: Vec<JournalEntry>,
}

fn canonical_key(raw: &str) -> Option<Uuid> {
    let key = raw.parse::<Uuid>().ok()?;
    (!key.is_nil() && key.hyphenated().to_string() == raw).then_some(key)
}

impl SignedRead {
    async fn account_for_key(
        &self,
        key: Uuid,
    ) -> Result<Option<MacroUserIdStr<'static>>, ReadError> {
        // The existing lookup index permits multiple historical profiles.
        let accounts = sqlx::query_scalar!(
            r#"SELECT id FROM "User" WHERE macro_user_id = $1 LIMIT 2"#,
            key,
        )
        .fetch_all(&self.authority.pool)
        .await
        .map_err(|_| ReadError::AuthorityFailed)?;
        let [account] = accounts.as_slice() else {
            return Ok(None);
        };
        Ok(MacroUserIdStr::try_from(account.to_owned()).ok())
    }

    async fn read(
        &self,
        viewer: &MacroUserIdStr<'static>,
        team: Uuid,
        agent_key: Uuid,
    ) -> Result<SignedJournal, ReadError> {
        let membership = self
            .authority
            .access
            .get_user_team(&viewer.0)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;
        if !membership
            .is_some_and(|current| current.team_id == team && current.role >= TeamRole::Admin)
        {
            return Err(ReadError::Unavailable);
        }

        let viewer_key = sqlx::query_scalar!(
            r#"SELECT macro_user_id FROM "User" WHERE id = $1 AND NOT "isAgent""#,
            viewer.as_ref(),
        )
        .fetch_optional(&self.authority.pool)
        .await
        .map_err(|_| ReadError::AuthorityFailed)?
        .ok_or(ReadError::Unavailable)?;

        if self.account_for_key(viewer_key).await?.as_ref() != Some(viewer) {
            return Err(ReadError::Unavailable);
        }
        let agent = self
            .account_for_key(agent_key)
            .await?
            .ok_or(ReadError::Unavailable)?;

        // The journal rechecks exact teammate membership and current document View permissions.
        let result = self
            .journal
            .read(&self.authority, viewer, &Scope { team, agent })
            .await?;

        Ok(SignedJournal {
            scope: SignedScope {
                viewer: viewer_key,
                team,
                agent: agent_key,
            },
            completed: result.completed,
        })
    }
}

async fn signed_read(
    State(state): State<SignedState>,
    path: Result<Path<(String, String)>, PathRejection>,
    OriginalUri(uri): OriginalUri,
    RawQuery(query): RawQuery,
    auth: Result<MacroAuthorizationExtractor<Authorization, UserOnly>, MacroAuthorizationRejection>,
) -> Response {
    let Ok(auth) = auth else {
        return ([(CACHE_CONTROL, "no-store")], StatusCode::UNAUTHORIZED).into_response();
    };
    let keys = path
        .ok()
        .and_then(|Path((team, agent))| Some((canonical_key(&team)?, canonical_key(&agent)?)));
    let result = match keys {
        Some((team, agent))
            if query.is_none()
                && uri.path() == format!("/teams/{team}/agents/{agent}/journal")
                && auth.authorization.is_human_session() =>
        {
            state
                .service
                .read(&auth.authorization.macro_user_id, team, agent)
                .await
        }
        _ => Err(ReadError::Unavailable),
    };

    let response = match result {
        Ok(view) => Json(view).into_response(),
        Err(ReadError::Unavailable) => StatusCode::NOT_FOUND.into_response(),
        Err(ReadError::AuthorityFailed) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    ([(CACHE_CONTROL, "no-store")], response).into_response()
}

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
                "http://{}/teams/{team}/agents/{agent}/journal",
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
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
         VALUES ($1, 'document', $2, 'user', 'view')",
        visible_doc,
        OWNER,
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

    let authorization = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(JwtValidationArgs::new_testing()),
        InternalAuthConfig {
            api_key: "unused-test-only".into(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    let app = Router::new()
        .route("/teams/{team}/agents/{agent}/journal", get(signed_read))
        .with_state(SignedState {
            service: Arc::new(SignedRead {
                authority: PgAuthority {
                    pool: pool.clone(),
                    access: EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone())),
                    agents,
                },
                journal,
            }),
            authorization: MacroAuthorizationState::new(Arc::new(authorization)),
        });

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
    assert_eq!(
        serde_json::from_slice::<SignedJournal>(&body).unwrap(),
        SignedJournal {
            scope: SignedScope {
                viewer,
                team,
                agent
            },
            completed: vec![JournalEntry {
                id: event,
                source: Source::Document { id: visible_doc },
                completed_at,
            }],
        }
    );

    let (status, body) = http.read(team, &empty_agent, Some(&owner)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        serde_json::from_slice::<SignedJournal>(&body)
            .unwrap()
            .completed
            .is_empty()
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
        "DELETE FROM entity_access WHERE entity_id = $1 AND entity_type = 'document' AND source_id = $2",
        visible_doc,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    let (status, body) = http.read(team, &agent_path, Some(&owner)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        serde_json::from_slice::<SignedJournal>(&body)
            .unwrap()
            .completed
            .is_empty()
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
