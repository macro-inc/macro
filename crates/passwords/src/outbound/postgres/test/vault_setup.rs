use super::*;
use crate::domain::{
    ports::{Provisioned, SetupError, VaultSetup},
    service::{
        PasswordService,
        test::fakes::{FakeAvailability, FakeProvider},
    },
};
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn setup_rows_record_states_backoff_and_count_as_team_data(pool: PgPool) {
    let (team, _) = another_team(&pool).await;
    let repository = PgRepository::new(pool).expect("repository");
    assert!(!repository.has_team_data(team).await.expect("team data"));
    assert_eq!(repository.vault_setup(team).await.expect("state"), None);

    assert!(repository.request_vault_setup(team).await.expect("request"));
    assert!(!repository.request_vault_setup(team).await.expect("repeat"));
    assert_eq!(
        repository.vault_setup(team).await.expect("state"),
        Some(VaultSetupState::SettingUp)
    );
    // A namespace may exist from here on, so team deletion must purge it.
    assert!(repository.has_team_data(team).await.expect("team data"));
    assert!(!repository.has_vault_values(team).await.expect("values"));
    assert_eq!(repository.vault_setup_due().await.expect("due"), vec![team]);

    // A failed attempt backs off: not due again right away.
    repository
        .record_vault_setup(team, VaultSetupState::SettingUp)
        .await
        .expect("retry");
    let (attempts, delay) = sqlx::query!(
        r#"SELECT attempts, (next_attempt_at - now()) > interval '4 seconds' AS "delayed!" FROM password_vault_setup WHERE team_id=$1"#,
        team.0
    )
    .fetch_one(&repository.pool)
    .await
    .map(|row| (row.attempts, row.delayed))
    .expect("row");
    assert_eq!((attempts, delay), (1, true));
    assert!(repository.vault_setup_due().await.expect("due").is_empty());

    sqlx::query!(
        "UPDATE password_vault_setup SET next_attempt_at=now() - interval '1 second' WHERE team_id=$1",
        team.0
    )
    .execute(&repository.pool)
    .await
    .expect("make due");
    assert_eq!(repository.vault_setup_due().await.expect("due"), vec![team]);

    // A closed team, and a team whose row outlived the team, are never due.
    repository.close_team(team).await.expect("close");
    assert!(repository.vault_setup_due().await.expect("due").is_empty());
    let orphan = TeamId(Uuid::now_v7());
    assert!(
        repository
            .request_vault_setup(orphan)
            .await
            .expect("orphan")
    );
    assert!(repository.vault_setup_due().await.expect("due").is_empty());

    repository
        .record_vault_setup(orphan, VaultSetupState::NeedsRecovery)
        .await
        .expect("drift");
    assert_eq!(
        repository.vault_setup(orphan).await.expect("state"),
        Some(VaultSetupState::NeedsRecovery)
    );
    // Final states ignore a late retry record.
    repository
        .record_vault_setup(orphan, VaultSetupState::SettingUp)
        .await
        .expect("late retry");
    assert_eq!(
        repository.vault_setup(orphan).await.expect("state"),
        Some(VaultSetupState::NeedsRecovery)
    );

    repository.purge_team_metadata(team).await.expect("purge");
    assert_eq!(repository.vault_setup(team).await.expect("state"), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_items_intents_and_enrollments_prove_a_namespace_existed(pool: PgPool) {
    let (team, actor) = another_team(&pool).await;
    let (repository, _, mut record) = folder_fixture(pool).await;
    assert!(
        repository
            .has_vault_values(record.metadata.team_id)
            .await
            .expect("values")
    );
    record.metadata.team_id = team;
    record.metadata.id = ItemId(Uuid::now_v7());
    record.user_id = actor.user_id.clone();
    // Folders need no namespace, so they are no proof one existed.
    repository
        .save_folder(&Folder {
            id: Uuid::now_v7(),
            team_id: team,
            name: "Operations".into(),
            parent_id: None,
        })
        .await
        .expect("folder");
    assert!(!repository.has_vault_values(team).await.expect("values"));
    repository
        .stage(Uuid::now_v7(), &record, &actor.user_id)
        .await
        .expect("intent");
    assert!(repository.has_vault_values(team).await.expect("values"));
}

/// A provisioner that holds every call until the gate opens, and counts calls.
struct GatedSetup {
    calls: AtomicUsize,
    entered: tokio::sync::Notify,
    gate: tokio::sync::Semaphore,
    outcome: Result<Provisioned, SetupError>,
    provider: Arc<FakeProvider>,
}
#[async_trait]
impl VaultSetup for GatedSetup {
    fn configured(&self) -> bool {
        true
    }
    async fn provision(
        &self,
        _team: TeamId,
        _deadline: std::time::Duration,
    ) -> Result<Provisioned, SetupError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.notify_one();
        let _permit = self.gate.acquire().await.expect("gate");
        if self.outcome.is_ok() {
            self.provider.unprovisioned.store(false, Ordering::SeqCst);
        }
        self.outcome
    }
    async fn namespace_exists(&self, _team: TeamId) -> Result<bool, SetupError> {
        Ok(false)
    }
}

fn login(operation_id: Uuid) -> WriteItem {
    WriteItem {
        private: false,
        operation_id,
        name: "Work login".into(),
        kind: ItemKind::Login,
        url: None,
        folder_id: None,
        favorite: false,
        expected_version: None,
        values: SecretValues {
            username: SecretString("login".into()),
            password: SecretString("sensitive-test-marker".into()),
            notes: SecretString(String::new()),
            fields: vec![],
        },
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_first_writes_ask_the_provisioner_once(pool: PgPool) {
    // A member's team with no items yet: its first write sets the vault up.
    let (team, actor) = another_team(&pool).await;
    let repository = PgRepository::new(pool).expect("repository");
    let repository = Arc::new(repository);
    let provider = Arc::new(FakeProvider::new());
    provider.unprovisioned.store(true, Ordering::SeqCst);
    let setup = Arc::new(GatedSetup {
        calls: AtomicUsize::new(0),
        entered: tokio::sync::Notify::new(),
        gate: tokio::sync::Semaphore::new(0),
        outcome: Ok(Provisioned { created: true }),
        provider: provider.clone(),
    });
    let service = Arc::new(PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(FakeAvailability),
        setup: setup.clone(),
    });
    let first = tokio::spawn({
        let (service, actor) = (service.clone(), actor.clone());
        async move { service.create(&actor, team, login(Uuid::now_v7())).await }
    });
    setup.entered.notified().await;
    // While the first write holds the lease, every other first write is turned
    // away; none reaches the provisioner.
    let others = futures::future::join_all(
        (0..7).map(|_| service.create(&actor, team, login(Uuid::now_v7()))),
    )
    .await;
    assert!(
        others
            .iter()
            .all(|result| result.as_ref().err() == Some(&Error::Busy))
    );
    setup.gate.add_permits(8);
    first
        .await
        .expect("task")
        .expect("first write saves once the vault is set up");
    assert_eq!(setup.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        repository.vault_setup(team).await.expect("state"),
        Some(VaultSetupState::Ready)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_timed_out_first_write_releases_the_lease_before_it_returns(pool: PgPool) {
    // A member's team with no items yet: its first write sets the vault up.
    let (team, actor) = another_team(&pool).await;
    let repository = PgRepository::new(pool).expect("repository");
    let repository = Arc::new(repository);
    let provider = Arc::new(FakeProvider::new());
    provider.unprovisioned.store(true, Ordering::SeqCst);
    let setup = Arc::new(GatedSetup {
        calls: AtomicUsize::new(0),
        entered: tokio::sync::Notify::new(),
        gate: tokio::sync::Semaphore::new(1),
        outcome: Err(SetupError::Unavailable),
        provider: provider.clone(),
    });
    let service = PasswordService {
        repository: repository.clone(),
        provider,
        availability: Arc::new(FakeAvailability),
        setup,
    };
    assert_eq!(
        service
            .create(&actor, team, login(Uuid::now_v7()))
            .await
            .err(),
        Some(Error::SettingUp)
    );
    // No pool draining: the lease was rolled back before the error returned.
    let _lease = repository
        .lock(team, ItemId(Uuid::now_v7()))
        .await
        .expect("the lease is free at once");
}
