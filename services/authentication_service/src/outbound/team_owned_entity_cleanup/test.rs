use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::StatusCode;

use super::*;

/// A team with no computers to release.
struct NoComputers;

#[async_trait::async_trait]
impl crate::domain::computer_billing::TeamComputers for NoComputers {
    async fn release_team(&self, _team_id: Uuid) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

fn record(owner: Owner) -> EntityRecord {
    EntityRecord {
        id: Uuid::from_u128(0xc4a7),
        entity_type: RegisteredEntityType::Chat,
        owner,
        created_at: DateTime::<Utc>::UNIX_EPOCH,
        updated_at: DateTime::<Utc>::UNIX_EPOCH,
        deleted_at: Some(DateTime::<Utc>::UNIX_EPOCH),
    }
}

#[test]
fn only_no_content_counts_as_purged() {
    assert_eq!(route_purge_outcome(StatusCode::NO_CONTENT), Ok(()));
    assert_eq!(
        route_purge_outcome(StatusCode::CONFLICT),
        Err(RoutePurgeError::OwnedElsewhere)
    );
    assert_eq!(
        route_purge_outcome(StatusCode::NOT_FOUND),
        Err(RoutePurgeError::UnexpectedResponse { status: 404 })
    );
    assert_eq!(
        route_purge_outcome(StatusCode::OK),
        Err(RoutePurgeError::UnexpectedResponse { status: 200 })
    );
    assert_eq!(
        route_purge_outcome(StatusCode::INTERNAL_SERVER_ERROR),
        Err(RoutePurgeError::UnexpectedResponse { status: 500 })
    );
}

#[test]
fn registry_rows_of_teams_and_bots_become_purgeable_and_a_users_row_is_refused() {
    let bot = BotId::new_from_uuid(Uuid::from_u128(0xb07));
    let team = Uuid::from_u128(0x7ea);

    assert_eq!(
        owned_entity_ref(record(Owner::Bot(bot))).unwrap(),
        OwnedEntityRef {
            id: Uuid::from_u128(0xc4a7),
            entity_type: RegisteredEntityType::Chat,
            owner: TeamDeletionOwner::Bot(bot),
        }
    );
    assert_eq!(
        owned_entity_ref(record(Owner::Team(team))).unwrap(),
        OwnedEntityRef {
            id: Uuid::from_u128(0xc4a7),
            entity_type: RegisteredEntityType::Chat,
            owner: TeamDeletionOwner::Team(team),
        }
    );
    let user = MacroUserIdStr::parse_from_str("macro|member@example.com").unwrap();
    assert!(owned_entity_ref(record(Owner::User(user))).is_err());
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn empty_team_skips_disabled_vault_rpc_but_existing_state_requires_acknowledged_purge(
    pool: sqlx::PgPool,
) {
    use passwords::domain::{models::TeamId, ports::Repository};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };
    let repository =
        Arc::new(passwords::outbound::postgres::PgRepository::new(pool.clone()).unwrap());
    let team = Uuid::now_v7();
    let server = MockServer::start().await;
    // A disabled/unconfigured DSS must never be consulted for a proven empty team.
    Mock::given(method("DELETE"))
        .respond_with(ResponseTemplate::new(503))
        .expect(0)
        .mount(&server)
        .await;
    let adapter = TeamOwnedEntityCleanupAdapter::new(
        repository.clone(),
        bots::outbound::pg_bots_repo::PgBotsRepo::new(pool.clone()),
        entity_registry::EntityRegistryServiceImpl::new(
            entity_registry::PgEntityRegistryRepository::new(pool.clone()),
        ),
        Arc::new(DocumentStorageServiceClient::new(
            "internal-key".into(),
            server.uri(),
        )),
        "internal-key".into(),
        server.uri(),
        server.uri(),
        Arc::new(NoComputers),
    )
    .unwrap();
    adapter.prepare_team_deletion(team).await.unwrap();
    assert!(!repository.has_team_data(TeamId(team)).await.unwrap());
    server.reset().await;
    // Even a retained namespace tombstone is existing state, never "empty".
    repository.close_team(TeamId(team)).await.unwrap();
    for status in [404, 503, 204] {
        Mock::given(method("DELETE"))
            .and(path(format!("/internal/passwords/teams/{team}")))
            .respond_with(ResponseTemplate::new(status))
            .expect(1)
            .mount(&server)
            .await;
        let result = adapter.prepare_team_deletion(team).await;
        assert_eq!(result.is_ok(), status == 204);
        assert!(repository.has_team_data(TeamId(team)).await.unwrap());
        server.verify().await;
        server.reset().await;
    }
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn empty_deletion_proof_keeps_first_create_lease_admission_closed_until_deletion_finishes(
    pool: sqlx::PgPool,
) {
    use passwords::domain::{
        models::{Error, ItemId, TeamId},
        ports::Repository,
    };
    use teams::domain::owned_entity_cleanup::clear_team;
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers::method};
    let repository =
        Arc::new(passwords::outbound::postgres::PgRepository::new(pool.clone()).unwrap());
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .respond_with(ResponseTemplate::new(503))
        .expect(0)
        .mount(&server)
        .await;
    let adapter = TeamOwnedEntityCleanupAdapter::new(
        repository.clone(),
        bots::outbound::pg_bots_repo::PgBotsRepo::new(pool.clone()),
        entity_registry::EntityRegistryServiceImpl::new(
            entity_registry::PgEntityRegistryRepository::new(pool.clone()),
        ),
        Arc::new(DocumentStorageServiceClient::new(
            "internal-key".into(),
            server.uri(),
        )),
        "internal-key".into(),
        server.uri(),
        server.uri(),
        Arc::new(NoComputers),
    )
    .unwrap();
    let team = TeamId(Uuid::now_v7());
    let cleared = clear_team(&adapter, team.0).await.unwrap();
    assert!(
        !repository.has_team_data(team).await.unwrap(),
        "empty deletion creates no fence or journal"
    );
    let create_repository = repository.clone();
    let create_admission =
        tokio::spawn(async move { create_repository.lock(team, ItemId(Uuid::now_v7())).await });
    assert!(matches!(create_admission.await.unwrap(), Err(Error::Busy)));
    assert_eq!(cleared.team_id(), team.0);
    // The proof is borrowed by the actual team-row deletion; it must retain its
    // guard after clear_team has returned, throughout subscription and row work.
    drop(cleared);
    // SQLx queues transaction rollback on Drop. Complete it deterministically.
    let mut connections = Vec::new();
    for _ in 0..pool.options().get_max_connections() {
        connections.push(pool.acquire().await.unwrap());
    }
    drop(connections);
    let admission = repository.lock(team, ItemId(Uuid::now_v7())).await.unwrap();
    drop(admission);
}
