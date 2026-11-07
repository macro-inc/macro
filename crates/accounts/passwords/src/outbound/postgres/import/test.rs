use super::*;
use crate::domain::ports::SecretProvider;
use crate::{
    domain::service::{PasswordService, test::fakes::FakeAvailability},
    outbound::{openbao::OpenBaoProvider, postgres::test::folder_fixture},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::process::Command;

mod benchmark;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn batch_excludes_other_writers_and_releases_after_completion_or_cancellation(pool: PgPool) {
    use crate::domain::service::test::fakes::{FakeProvider, WriteGate};
    let (repository, actor, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let repository = Arc::new(repository);
    for complete in [true, false] {
        let provider = Arc::new(FakeProvider::new());
        let gate = Arc::new(WriteGate::new());
        *provider.all_writes_gate.lock().unwrap() = Some(gate.clone());
        let service = PasswordService {
            repository: repository.clone(),
            provider: provider.clone(),
            availability: Arc::new(FakeAvailability),
        };
        let batch = synthetic_batch();
        let mut work = Box::pin(service.import_batch(&actor, team, Uuid::now_v7(), batch));
        tokio::select! {
            _ = gate.started.notified() => {},
            _ = &mut work => panic!("provider gate must hold the batch"),
        }
        let operation = Uuid::now_v7();
        let ordinary = || {
            serde_json::from_value(serde_json::json!({
            "operationId":operation, "name":"Synthetic ordinary write", "kind":"login", "favorite":false,"private":false,
            "values":{"username":"", "password":"synthetic", "notes":"", "fields":[]}
        })).unwrap()
        };
        assert!(matches!(
            service.create(&actor, team, ordinary()).await,
            Err(Error::Busy)
        ));
        if complete {
            gate.release.add_permits(2);
            let result = work.await.unwrap();
            assert!(
                result
                    .items
                    .iter()
                    .all(|item| item.outcome == ImportOutcome::Created)
            );
            assert_eq!(provider.stored.lock().unwrap().len(), 2);
        } else {
            drop(work);
            assert!(provider.stored.lock().unwrap().is_empty());
        }
        *provider.all_writes_gate.lock().unwrap() = None;
        // SQLx rolls a dropped transaction back asynchronously. Drain the pool
        // to prove the server processed it before testing the next admission.
        let mut connections = Vec::new();
        for _ in 0..pool.options().get_max_connections() {
            connections.push(pool.acquire().await.unwrap());
        }
        drop(connections);
        let created = service.create(&actor, team, ordinary()).await.unwrap();
        assert_eq!(created.metadata.id, ItemId(operation));
        assert_eq!(created.metadata.version, 1);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "requires explicit disposable local OpenBao and bootstrap signing key"]
#[expect(
    clippy::disallowed_methods,
    reason = "disposable integration fixture requires explicit local provider configuration"
)]
async fn real_import_retries_preserve_provider_version_folder_grants_and_totp(pool: PgPool) {
    let (repository, actor, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let address =
        std::env::var("PASSWORDS_TEST_OPENBAO_ADDRESS").expect("explicit disposable address");
    let key_path = std::env::var("PASSWORDS_TEST_OPENBAO_SIGNING_KEY").expect("synthetic key path");
    let public_key_path =
        std::env::var("PASSWORDS_TEST_OPENBAO_PUBLIC_KEY").expect("synthetic public key path");
    assert!(
        Command::new("python3")
            .args([
                "../../infra/local/openbao/bootstrap.py",
                "--address",
                &address,
                "--team-id",
                &team.0.to_string(),
                "--jwt-public-key",
                &public_key_path,
                "--jwt-issuer",
                "macro-local-passwords",
            ])
            .status()
            .expect("bootstrap")
            .success()
    );
    let provider = Arc::new(
        OpenBaoProvider::new(
            address,
            "macro-local-passwords".into(),
            &std::fs::read_to_string(key_path).expect("synthetic key"),
        )
        .unwrap(),
    );
    let repository = Arc::new(repository);
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(FakeAvailability),
    };
    let import_id = Uuid::now_v7();
    let input = serde_json::json!({
        "format":"bitwarden_json", "target":{"kind":"new","name":"Synthetic import"},"private":true,
        "folders":[{"key":"parent","name":"Synthetic parent"},{"key":"child","name":"Synthetic child","parentKey":"parent"}],
        "items":[{"sourceKey":"item","name":"Synthetic credential","kind":"login","folderKey":"child","favorite":false,
            "values":{"username":"synthetic-import-user","password":"synthetic-import-value","notes":"","fields":[]},
            "totp":"JBSWY3DPEHPK3PXP"}]
    });
    let first = service
        .import_batch(
            &actor,
            team,
            import_id,
            serde_json::from_value(input.clone()).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.items[0].outcome, ImportOutcome::Created);
    let id = first.items[0].item_id.unwrap();
    let original = repository.get(team, id).await.unwrap();
    assert!(original.grants.is_empty());
    assert!(original.metadata.has_totp);
    assert_eq!(
        original.metadata.folder_id,
        Some(first.folders[1].folder_id)
    );
    let second = service
        .import_batch(
            &actor,
            team,
            import_id,
            serde_json::from_value(input).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.items[0].outcome, ImportOutcome::AlreadyPresent);
    assert_eq!(second.items[0].item_id, Some(id));
    let retained = repository.get(team, id).await.unwrap();
    assert_eq!(retained.totp_key_id, original.totp_key_id);
    assert_eq!(retained.metadata.version, 1);
    assert_eq!(provider.current_version(team, id).await.unwrap(), Some(1));
    let values = provider.read(team, id, 1).await.unwrap();
    assert_eq!(values.password.0, "synthetic-import-value");
    assert_eq!(
        provider
            .totp(team, retained.totp_key_id.unwrap())
            .await
            .unwrap()
            .code
            .0
            .len(),
        6
    );
    let audit = sqlx::query!("SELECT created,already_present,failed FROM password_import_activity WHERE team_id=$1 ORDER BY id",team.0).fetch_all(&pool).await.unwrap();
    assert_eq!(audit.len(), 2);
    assert_eq!(
        (audit[0].created, audit[0].already_present, audit[0].failed),
        (1, 0, 0)
    );
    assert_eq!(
        (audit[1].created, audit[1].already_present, audit[1].failed),
        (0, 1, 0)
    );
    // Only this disposable namespace is erased, using the normal trusted purge path.
    for _ in 0..4 {
        let purged = service.purge_team(team).await;
        let mut connections = Vec::new();
        for _ in 0..pool.options().get_max_connections() {
            connections.push(pool.acquire().await.unwrap());
        }
        drop(connections);
        match purged {
            Ok(()) => return,
            Err(Error::Busy) => {}
            Err(error) => panic!("disposable purge failed: {error}"),
        }
    }
    panic!("disposable namespace purge acknowledgement did not complete");
}

fn synthetic_batch() -> ImportBatch {
    serde_json::from_value(serde_json::json!({
        "format":"bitwarden_json", "target":{"kind":"root"}, "private":false, "folders":[],
        "items":[
            {"sourceKey":"one", "name":"Synthetic one", "kind":"login", "favorite":false,
             "values":{"username":"", "password":"synthetic", "notes":"", "fields":[]}},
            {"sourceKey":"two", "name":"Synthetic two", "kind":"login", "favorite":false,
             "values":{"username":"", "password":"synthetic", "notes":"", "fields":[]}}
        ]
    }))
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imports_progress_with_only_a_lease_and_one_query_connection(pool: PgPool) {
    let limited = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    let (repository, actor, record) = folder_fixture(limited.clone()).await;
    let service = PasswordService {
        repository: Arc::new(repository),
        provider: Arc::new(crate::domain::service::test::fakes::FakeProvider::new()),
        availability: Arc::new(FakeAvailability),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        service.import_batch(
            &actor,
            record.metadata.team_id,
            Uuid::now_v7(),
            synthetic_batch(),
        ),
    )
    .await
    .expect("small pools must not deadlock")
    .unwrap();
    assert_eq!(result.items.len(), 2);
    assert!(
        result
            .items
            .iter()
            .all(|item| item.outcome == ImportOutcome::Created)
    );
    limited.close().await;
}

/// 20261116193746 widens the format check NOT VALID for `bitwarden_zip`,
/// 20261116193752 validates it.
const WIDEN_FORMAT_CHECK: i64 = 20261116193746;

async fn insert_activity(pool: &PgPool, team: Uuid, format: &str) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO password_import_activity(team_id,id,import_id,user_id,format,created,already_present,failed,folders) VALUES($1,$2,$3,'macro|owner@example.com',$4,1,0,0,0)",
        team, Uuid::now_v7(), Uuid::now_v7(), format,
    )
    .execute(pool)
    .await
    .map(|_| ())
}

async fn format_check_validated(pool: &PgPool) -> bool {
    sqlx::query_scalar!(
        "SELECT convalidated FROM pg_constraint WHERE conname='password_import_activity_format_check'"
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = false)]
async fn format_check_widening_keeps_old_rows_valid_and_migrates_up_down_up(pool: PgPool) {
    // sqlx::test owns this disposable database; templates may already be migrated.
    sqlx::raw_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        .execute(&pool)
        .await
        .unwrap();
    let before_widening = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < WIDEN_FORMAT_CHECK)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    before_widening.run(&pool).await.unwrap();
    let user = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'owner', 'owner@example.com', 'owner')", user)
        .execute(&pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|owner@example.com', 'owner@example.com', $1)"#, user)
        .execute(&pool).await.unwrap();
    let team = Uuid::now_v7();
    sqlx::query!("INSERT INTO team (id, name, owner_id) VALUES ($1, 'Import team', 'macro|owner@example.com')", team)
        .execute(&pool).await.unwrap();

    // A row the deployed code wrote before the migration.
    insert_activity(&pool, team, "bitwarden_json")
        .await
        .unwrap();
    assert!(insert_activity(&pool, team, "bitwarden_zip").await.is_err());

    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    assert!(format_check_validated(&pool).await);
    insert_activity(&pool, team, "bitwarden_zip").await.unwrap();
    insert_activity(&pool, team, "one_password_pux")
        .await
        .unwrap();
    assert!(insert_activity(&pool, team, "lastpass").await.is_err());

    // Down keeps the rows written meanwhile and checks only new ones.
    MACRO_DB_MIGRATIONS
        .undo(&pool, WIDEN_FORMAT_CHECK - 1)
        .await
        .unwrap();
    assert!(!format_check_validated(&pool).await);
    assert!(insert_activity(&pool, team, "bitwarden_zip").await.is_err());
    insert_activity(&pool, team, "bitwarden_csv").await.unwrap();

    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    assert!(format_check_validated(&pool).await);
    insert_activity(&pool, team, "bitwarden_zip").await.unwrap();
    let formats = sqlx::query_scalar!(
        "SELECT format FROM password_import_activity WHERE team_id=$1 ORDER BY id",
        team
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        formats,
        [
            "bitwarden_json",
            "bitwarden_zip",
            "one_password_pux",
            "bitwarden_csv",
            "bitwarden_zip"
        ]
    );
}
