use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header::CACHE_CONTROL},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use team_agents::{
    domain::{
        models::{AgentName, NewAgentAccount, PersonaSeed, PurchaseKey},
        ports::{AgentAccounts, TeamAgentRepository},
    },
    outbound::pg_team_agents_repo::PgTeamAgentsRepo,
};
use tower::ServiceExt;

use entity_access::{
    domain::{models::TeamRole, ports::EntityAccessService, service::EntityAccessServiceImpl},
    outbound::PgAccessRepository,
};

use super::{
    inbound::{Viewer, router},
    *,
};

const OWNER: &str = "macro|journal-owner@example.com";
const MEMBER: &str = "macro|journal-member@example.com";
const FOREIGN_OWNER: &str = "macro|foreign-owner@example.com";
const AGENT: &str = "macro|journal-agent@example.com";
const OTHER_AGENT: &str = "macro|other-agent@example.com";
const FOREIGN_AGENT: &str = "macro|foreign-agent@example.com";

struct PgAuthority {
    pool: PgPool,
    access: EntityAccessServiceImpl<PgAccessRepository>,
    agents: PgTeamAgentsRepo,
}

impl Authority for PgAuthority {
    async fn can_read(
        &self,
        viewer: &MacroUserIdStr<'static>,
        scope: &Scope,
    ) -> Result<bool, ReadError> {
        let membership = self
            .access
            .get_user_team(&viewer.0)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;
        if !membership
            .is_some_and(|team| team.team_id == scope.team && team.role >= TeamRole::Admin)
        {
            return Ok(false);
        }
        Ok(self
            .agents
            .account_facts(&scope.agent)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?
            .is_some_and(|agent| agent.team_id == scope.team && agent.is_agent && agent.member))
    }

    async fn visible_documents(
        &self,
        viewer: &MacroUserIdStr<'static>,
        ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, ReadError> {
        let requested: Vec<_> = ids.iter().map(ToString::to_string).collect();
        // A retained access grant cannot establish that its source still exists.
        let live = sqlx::query_scalar!(
            r#"SELECT id FROM "Document" WHERE id = ANY($1) AND "deletedAt" IS NULL"#,
            &requested,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|_| ReadError::AuthorityFailed)?;
        let authorized = self
            .access
            .generate_document_view_access_receipts(&viewer.0, &live)
            .await
            .map_err(|_| ReadError::AuthorityFailed)?;
        Ok(ids
            .iter()
            .copied()
            .zip(requested)
            .filter_map(|(id, key)| authorized.contains_key(&key).then_some(id))
            .collect())
    }
}

async fn seed_user(pool: &PgPool, user: &str) {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        id,
        user,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_team(pool: &PgPool, owner: &str) -> Uuid {
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Journal fixture team', $2)",
        team,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    team
}

async fn seed_agent(
    pool: &PgPool,
    agents: &PgTeamAgentsRepo,
    team: Uuid,
    agent: &str,
    creator: &str,
) {
    agents
        .create_account(&NewAgentAccount {
            user_id: user(agent),
            email: agent.strip_prefix("macro|").unwrap().to_owned(),
            team_id: team,
            created_by: user(creator),
            name: AgentName::try_new("Journal fixture").unwrap(),
            avatar_url: None,
            persona_seed: PersonaSeed {
                creator_id: Some(user(creator)),
                name: "Journal fixture".to_owned(),
                job_description: String::new(),
                personality: String::new(),
                voice: None,
            },
            purchase_key: PurchaseKey::try_new(Uuid::now_v7().to_string()).unwrap(),
        })
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
        team,
        agent,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_owned()).unwrap()
}

fn scope(team: Uuid, agent: &str) -> Scope {
    Scope {
        team,
        agent: user(agent),
    }
}

async fn seed_document(pool: &PgPool, owner: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, 'Journal fixture', $2)"#,
        id.to_string(),
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn request(
    app: &axum::Router,
    team: Uuid,
    agent: &str,
    suffix: &str,
    viewer: Option<&str>,
) -> (StatusCode, Vec<u8>) {
    let agent = agent.replace('|', "%7C").replace('@', "%40");
    let mut request = Request::builder()
        .uri(format!("/teams/{team}/agents/{agent}/journal{suffix}"))
        .header("Authorization", "Bearer fixture-does-not-mint-identity");
    if let Some(viewer) = viewer {
        request = request.extension(Viewer(user(viewer)));
    }

    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    if suffix.is_empty() {
        assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
    }
    let status = response.status();
    let body = to_bytes(response.into_body(), 16 * 1024).await.unwrap();
    (status, body.to_vec())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn router_reads_current_team_agent_and_source_authority(pool: PgPool) {
    seed_user(&pool, OWNER).await;
    seed_user(&pool, MEMBER).await;
    seed_user(&pool, FOREIGN_OWNER).await;
    let team = seed_team(&pool, OWNER).await;
    let other_team = seed_team(&pool, FOREIGN_OWNER).await;
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
    seed_agent(&pool, &agents, other_team, FOREIGN_AGENT, FOREIGN_OWNER).await;
    let doc = seed_document(&pool, MEMBER).await;
    let hidden_doc = seed_document(&pool, MEMBER).await;
    let missing_doc = Uuid::now_v7();
    for id in [doc, missing_doc] {
        sqlx::query!(
            "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
             VALUES ($1, 'document', $2, 'user', 'view')",
            id,
            OWNER,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let journal = Journal::default();
    let completed_at = Utc::now();
    let source_event = Uuid::now_v7();
    for (event, id) in [
        (source_event, doc),
        (Uuid::now_v7(), hidden_doc),
        (Uuid::now_v7(), missing_doc),
    ] {
        journal
            .observe(
                scope(team, AGENT),
                CompletedWork {
                    source_event: event,
                    source: Source::Document { id },
                    completed_at,
                },
            )
            .unwrap();
    }

    let app = router(
        PgAuthority {
            pool: pool.clone(),
            access: EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone())),
            agents,
        },
        journal,
    );

    let (status, body) = request(&app, team, AGENT, "", Some(OWNER)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<JournalView>(&body).unwrap(),
        JournalView {
            completed: vec![JournalEntry {
                id: source_event,
                source: Source::Document { id: doc },
                completed_at
            }],
        }
    );

    let (status, body) = request(&app, team, OTHER_AGENT, "", Some(OWNER)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<JournalView>(&body).unwrap(),
        JournalView {
            completed: Vec::new()
        }
    );

    for (team, agent, suffix, viewer) in [
        (team, AGENT, "", None),
        (team, AGENT, "", Some(MEMBER)),
        (other_team, AGENT, "", Some(OWNER)),
        (team, FOREIGN_AGENT, "", Some(OWNER)),
        (other_team, AGENT, "", Some(FOREIGN_OWNER)),
        (team, "macro|missing-agent@example.com", "", Some(OWNER)),
        (team, AGENT, "/attempts/unknown", Some(OWNER)),
    ] {
        assert_eq!(
            request(&app, team, agent, suffix, viewer).await,
            (StatusCode::NOT_FOUND, Vec::new())
        );
    }

    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND entity_type = 'document' AND source_id = $2",
        doc,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    let (status, body) = request(&app, team, AGENT, "", Some(OWNER)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<JournalView>(&body).unwrap(),
        JournalView {
            completed: Vec::new()
        }
    );

    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        AGENT
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(&app, team, AGENT, "", Some(OWNER)).await,
        (StatusCode::NOT_FOUND, Vec::new())
    );

    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(&app, team, OTHER_AGENT, "", Some(OWNER)).await,
        (StatusCode::NOT_FOUND, Vec::new())
    );

    pool.close().await;
    assert_eq!(
        request(&app, team, AGENT, "", Some(OWNER)).await,
        (StatusCode::SERVICE_UNAVAILABLE, Vec::new())
    );
}

#[test]
fn completed_observation_is_idempotent_per_agent() {
    let team = Uuid::now_v7();
    let selected = scope(team, AGENT);
    let other = scope(team, OTHER_AGENT);
    let journal = Journal::default();
    let work = CompletedWork {
        source_event: Uuid::now_v7(),
        source: Source::Document { id: Uuid::now_v7() },
        completed_at: Utc::now(),
    };

    std::thread::scope(|threads| {
        let first = threads.spawn(|| journal.observe(selected.clone(), work.clone()));
        let second = journal.observe(selected.clone(), work.clone());
        assert!(matches!(
            (first.join().unwrap(), second),
            (Ok(Observed::Recorded), Ok(Observed::Replay))
                | (Ok(Observed::Replay), Ok(Observed::Recorded))
        ));
    });

    let changed = CompletedWork {
        source: Source::Document { id: Uuid::now_v7() },
        ..work.clone()
    };
    assert_eq!(
        journal.observe(selected, changed),
        Err(ObserveError::ChangedReplay)
    );
    assert_eq!(journal.observe(other, work), Ok(Observed::Recorded));
    assert!(serde_json::from_str::<Source>(r#"{"kind":"unknown"}"#).is_err());
}

#[path = "signed_test.rs"]
mod signed;
