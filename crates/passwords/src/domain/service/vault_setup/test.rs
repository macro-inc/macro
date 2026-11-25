use super::super::test::fakes::*;
use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::atomic::Ordering;

struct Fixture {
    repository: Arc<FakeRepository>,
    provider: Arc<FakeProvider>,
    setup: Arc<FakeVaultSetup>,
    service: PasswordService,
    owner: Actor,
    team: TeamId,
}

/// A member of a team whose namespace does not exist yet, with a provisioner.
fn fixture() -> Fixture {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    provider.unprovisioned.store(true, Ordering::SeqCst);
    let setup = Arc::new(FakeVaultSetup::new(provider.clone()));
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("valid fixture")
            .into_owned(),
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .unwrap()
        .insert(owner.user_id.to_string(), vec![team]);
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(FakeAvailability),
        setup: setup.clone(),
    };
    Fixture {
        repository,
        provider,
        setup,
        service,
        owner,
        team,
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

fn setup_row(fixture: &Fixture) -> Option<(VaultSetupState, u32)> {
    fixture
        .repository
        .vault_setups
        .lock()
        .unwrap()
        .get(&fixture.team.0)
        .copied()
}

#[tokio::test]
async fn the_first_write_sets_up_the_vault_and_the_same_save_succeeds() {
    let fixture = fixture();
    let operation = Uuid::now_v7();
    let created = fixture
        .service
        .create(&fixture.owner, fixture.team, login(operation))
        .await
        .expect("the save succeeds once the vault is set up");
    assert_eq!(created.metadata.id, ItemId(operation));
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        *fixture.setup.deadlines.lock().unwrap(),
        vec![std::time::Duration::from_secs(8)]
    );
    assert_eq!(setup_row(&fixture), Some((VaultSetupState::Ready, 0)));
    assert!(
        fixture
            .provider
            .stored
            .lock()
            .unwrap()
            .contains_key(&operation)
    );
}

#[tokio::test]
async fn a_timed_out_first_attempt_releases_the_lease_and_keeps_only_the_request() {
    let fixture = fixture();
    *fixture.setup.outcome.lock().unwrap() = Err(SetupError::Unavailable);
    let operation = Uuid::now_v7();
    let result = fixture
        .service
        .create(&fixture.owner, fixture.team, login(operation))
        .await;
    assert_eq!(result.err(), Some(Error::SettingUp));
    assert_eq!(fixture.repository.live_leases.load(Ordering::SeqCst), 0);
    assert_eq!(setup_row(&fixture), Some((VaultSetupState::SettingUp, 1)));
    // Nothing of the save was staged or written: a retry sends it again.
    assert!(fixture.repository.staged.lock().unwrap().is_empty());
    assert!(fixture.provider.stored.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_later_write_while_setting_up_returns_at_once_without_asking_the_provisioner() {
    let fixture = fixture();
    fixture
        .repository
        .vault_setups
        .lock()
        .unwrap()
        .insert(fixture.team.0, (VaultSetupState::SettingUp, 1));
    let result = fixture
        .service
        .create(&fixture.owner, fixture.team, login(Uuid::now_v7()))
        .await;
    assert_eq!(result.err(), Some(Error::SettingUp));
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn the_resume_worker_finishes_a_setup_and_the_retried_save_succeeds() {
    let fixture = fixture();
    *fixture.setup.outcome.lock().unwrap() = Err(SetupError::Unavailable);
    let operation = Uuid::now_v7();
    let first = fixture
        .service
        .create(&fixture.owner, fixture.team, login(operation))
        .await;
    assert_eq!(first.err(), Some(Error::SettingUp));

    *fixture.setup.outcome.lock().unwrap() = Ok(Provisioned { created: true });
    fixture
        .repository
        .setup_due
        .lock()
        .unwrap()
        .push(fixture.team);
    fixture
        .service
        .resume_vault_setup()
        .await
        .expect("resume pass");
    assert_eq!(
        setup_row(&fixture).map(|row| row.0),
        Some(VaultSetupState::Ready)
    );
    assert_eq!(fixture.repository.live_leases.load(Ordering::SeqCst), 0);

    // The same operation, retried: no further provisioning.
    fixture
        .service
        .create(&fixture.owner, fixture.team, login(operation))
        .await
        .expect("retried save");
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 2);
    assert!(
        fixture
            .provider
            .stored
            .lock()
            .unwrap()
            .contains_key(&operation)
    );
}

#[tokio::test]
async fn an_incompatible_vault_fails_and_is_never_retried() {
    let fixture = fixture();
    *fixture.setup.outcome.lock().unwrap() = Err(SetupError::Incompatible);
    let first = fixture
        .service
        .create(&fixture.owner, fixture.team, login(Uuid::now_v7()))
        .await;
    assert_eq!(first.err(), Some(Error::SetupFailed));
    assert_eq!(
        setup_row(&fixture).map(|row| row.0),
        Some(VaultSetupState::Failed)
    );

    fixture
        .repository
        .setup_due
        .lock()
        .unwrap()
        .push(fixture.team);
    fixture
        .service
        .resume_vault_setup()
        .await
        .expect("resume pass");
    let second = fixture
        .service
        .create(&fixture.owner, fixture.team, login(Uuid::now_v7()))
        .await;
    assert_eq!(second.err(), Some(Error::SetupFailed));
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_vault_missing_after_it_was_ready_is_drift_not_a_new_vault() {
    let fixture = fixture();
    fixture
        .repository
        .vault_setups
        .lock()
        .unwrap()
        .insert(fixture.team.0, (VaultSetupState::Ready, 0));
    let result = fixture
        .service
        .create(&fixture.owner, fixture.team, login(Uuid::now_v7()))
        .await;
    assert_eq!(result.err(), Some(Error::NeedsRecovery));
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        setup_row(&fixture).map(|row| row.0),
        Some(VaultSetupState::NeedsRecovery)
    );
}

#[tokio::test]
async fn a_vault_missing_with_items_from_before_setup_existed_is_drift() {
    // A team provisioned by hand before setup rows existed: it has items and no row.
    let fixture = fixture();
    fixture
        .provider
        .unprovisioned
        .store(false, Ordering::SeqCst);
    let existing = fixture
        .service
        .create(&fixture.owner, fixture.team, login(Uuid::now_v7()))
        .await
        .expect("create while the namespace exists");
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 0);
    fixture.provider.unprovisioned.store(true, Ordering::SeqCst);

    let created = fixture
        .service
        .create(&fixture.owner, fixture.team, login(Uuid::now_v7()))
        .await;
    assert_eq!(created.err(), Some(Error::NeedsRecovery));
    let mut update = login(Uuid::now_v7());
    update.expected_version = Some(existing.metadata.version);
    let updated = fixture
        .service
        .update(&fixture.owner, fixture.team, existing.metadata.id, update)
        .await;
    assert_eq!(updated.err(), Some(Error::NeedsRecovery));
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_closed_team_is_never_set_up_again() {
    let fixture = fixture();
    fixture
        .repository
        .vault_setups
        .lock()
        .unwrap()
        .insert(fixture.team.0, (VaultSetupState::SettingUp, 1));
    fixture
        .repository
        .closed_teams
        .lock()
        .unwrap()
        .insert(fixture.team.0);
    fixture
        .repository
        .setup_due
        .lock()
        .unwrap()
        .push(fixture.team);
    fixture
        .service
        .resume_vault_setup()
        .await
        .expect("resume pass");
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn purge_skips_erasing_a_namespace_an_unfinished_setup_never_created() {
    let fixture = fixture();
    fixture
        .repository
        .vault_setups
        .lock()
        .unwrap()
        .insert(fixture.team.0, (VaultSetupState::SettingUp, 3));
    fixture
        .service
        .purge_team(fixture.team)
        .await
        .expect("purge");
    assert!(fixture.provider.purged.lock().unwrap().is_empty());
    assert!(
        fixture
            .repository
            .closed_teams
            .lock()
            .unwrap()
            .contains(&fixture.team.0)
    );
    assert_eq!(setup_row(&fixture), None);

    // Once anything exists, purge erases it as before.
    let fixture = self::fixture();
    fixture
        .repository
        .vault_setups
        .lock()
        .unwrap()
        .insert(fixture.team.0, (VaultSetupState::SettingUp, 1));
    fixture.setup.namespace_exists.store(true, Ordering::SeqCst);
    fixture
        .service
        .purge_team(fixture.team)
        .await
        .expect("purge");
    assert_eq!(*fixture.provider.purged.lock().unwrap(), vec![fixture.team]);
}

#[tokio::test]
async fn without_a_provisioner_a_missing_vault_stays_not_provisioned() {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    provider.unprovisioned.store(true, Ordering::SeqCst);
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("valid fixture")
            .into_owned(),
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .unwrap()
        .insert(owner.user_id.to_string(), vec![team]);
    let service = PasswordService {
        repository: repository.clone(),
        provider,
        availability: Arc::new(FakeAvailability),
        setup: Arc::new(crate::outbound::vault_setup::NoVaultSetup),
    };
    let result = service.create(&owner, team, login(Uuid::now_v7())).await;
    assert_eq!(result.err(), Some(Error::NotProvisioned));
    assert!(repository.vault_setups.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_provider_outage_only_reads_as_setting_up_while_a_setup_is_open() {
    let fixture = fixture();
    assert_eq!(
        fixture
            .service
            .while_setting_up(fixture.team, Error::Unavailable)
            .await,
        Error::Unavailable
    );
    fixture
        .repository
        .vault_setups
        .lock()
        .unwrap()
        .insert(fixture.team.0, (VaultSetupState::SettingUp, 1));
    assert_eq!(
        fixture
            .service
            .while_setting_up(fixture.team, Error::Unavailable)
            .await,
        Error::SettingUp
    );
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn readiness_reports_every_state_without_starting_a_setup() {
    let fixture = fixture();
    let readiness = |state, reason| VaultReadiness { state, reason };
    assert_eq!(
        fixture
            .service
            .vault_readiness(&fixture.owner, fixture.team)
            .await,
        Ok(readiness(VaultReadinessState::NotStarted, None))
    );
    for (state, expected) in [
        (
            VaultSetupState::SettingUp,
            readiness(VaultReadinessState::SettingUp, None),
        ),
        (
            VaultSetupState::Ready,
            readiness(VaultReadinessState::Ready, None),
        ),
        (
            VaultSetupState::Failed,
            readiness(
                VaultReadinessState::Failed,
                Some(VaultFailureReason::Incompatible),
            ),
        ),
        (
            VaultSetupState::NeedsRecovery,
            readiness(
                VaultReadinessState::Failed,
                Some(VaultFailureReason::NeedsRecovery),
            ),
        ),
    ] {
        fixture
            .repository
            .vault_setups
            .lock()
            .unwrap()
            .insert(fixture.team.0, (state, 0));
        assert_eq!(
            fixture
                .service
                .vault_readiness(&fixture.owner, fixture.team)
                .await,
            Ok(expected)
        );
    }
    let stranger = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|stranger@example.test")
            .expect("valid fixture")
            .into_owned(),
    };
    assert_eq!(
        fixture
            .service
            .vault_readiness(&stranger, fixture.team)
            .await,
        Err(Error::NotFound)
    );
    assert_eq!(fixture.setup.calls.load(Ordering::SeqCst), 0);
}
