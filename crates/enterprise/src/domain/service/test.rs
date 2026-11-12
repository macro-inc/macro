use super::*;
use crate::audit::AuditRecord;
use crate::domain::RuntimePreset;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, TeamRole};
use std::sync::{Arc, Mutex};

const TEAM_ID: Uuid = Uuid::from_u128(0x1234);

#[derive(Default)]
struct State {
    disabled: bool,
    allowlist: Option<RuntimePresetAllowlist>,
    commits: Vec<(bool, AuditResult)>,
    bindings: Vec<VerifiedRoxIdentity>,
}

#[derive(Clone, Default)]
struct FakeRepo(Arc<Mutex<State>>);

impl EnterpriseRepository for FakeRepo {
    async fn bind_verified(
        &self,
        _macro_user_id: &MacroUserIdStr<'_>,
        identity: VerifiedRoxIdentity,
    ) -> Result<()> {
        self.0.lock().unwrap().bindings.push(identity);
        Ok(())
    }

    async fn commit_member_state(
        &self,
        _actor: &MacroUserIdStr<'_>,
        _member: &MacroUserIdStr<'_>,
        disabled: bool,
        result: AuditResult,
    ) -> Result<()> {
        let mut state = self.0.lock().unwrap();
        state.disabled = disabled;
        state.commits.push((disabled, result));
        Ok(())
    }

    async fn member_disabled(&self, _member: &MacroUserIdStr<'_>) -> Result<bool> {
        Ok(self.0.lock().unwrap().disabled)
    }

    async fn set_runtime_allowlist(
        &self,
        _team_id: Uuid,
        allowlist: Option<&RuntimePresetAllowlist>,
    ) -> Result<()> {
        self.0.lock().unwrap().allowlist = allowlist.cloned();
        Ok(())
    }

    async fn runtime_allowlist(&self, _team_id: Uuid) -> Result<Option<RuntimePresetAllowlist>> {
        Ok(self.0.lock().unwrap().allowlist.clone())
    }

    async fn record(&self, _record: AuditRecord) -> Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
struct FakeTeams(Vec<Uuid>);

impl TeamDirectory for FakeTeams {
    async fn team_ids(&self, _user: MacroUserIdStr<'static>) -> Result<Vec<Uuid>> {
        Ok(self.0.clone())
    }
}

#[derive(Clone, Default)]
struct FakeLifecycle(Arc<Mutex<Vec<String>>>);

impl UserLifecycle for FakeLifecycle {
    async fn deactivate_user(&self, fusion_user_id: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .push(format!("deactivate:{fusion_user_id}"));
        Ok(())
    }

    async fn reactivate_user(&self, fusion_user_id: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .push(format!("reactivate:{fusion_user_id}"));
        Ok(())
    }
}

#[derive(Clone)]
struct FakeMembers;

impl MemberDirectory for FakeMembers {
    async fn fusion_user_id(&self, _user: &MacroUserIdStr<'_>) -> Result<String> {
        Ok("fusion-member".to_owned())
    }
}

#[derive(Clone)]
struct FakeHarnesses;

impl HarnessRevoker for FakeHarnesses {
    async fn revoke_server_records(&self, _member: &MacroUserIdStr<'_>) -> Result<usize> {
        Ok(2)
    }
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn receipt() -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::try_new_authenticated_user(
        user("admin@example.com"),
        Entity {
            entity_id: TEAM_ID.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Admin,
        },
    )
    .unwrap()
}

fn service(
    repository: FakeRepo,
    lifecycle: FakeLifecycle,
) -> EnterpriseService<FakeRepo, FakeTeams, FakeLifecycle, FakeMembers, FakeHarnesses> {
    EnterpriseService::new(
        repository,
        FakeTeams(vec![TEAM_ID]),
        lifecycle,
        FakeMembers,
        FakeHarnesses,
    )
}

#[tokio::test]
async fn production_broker_returns_typed_gap_without_a_network_port() {
    assert!(matches!(
        ProductionIdentityBroker.exchange().await,
        Err(EnterpriseError::BrokerExchangeGap)
    ));
}

#[derive(Clone)]
struct FakeBroker;

impl IdentityBroker for FakeBroker {
    async fn exchange(&self) -> Result<VerifiedRoxIdentity> {
        VerifiedRoxIdentity::new("rox-account", "member")
    }
}

#[tokio::test]
async fn fake_broker_supplies_verified_identity_for_binding() {
    let repository = FakeRepo::default();
    let service = service(repository.clone(), FakeLifecycle::default());

    service
        .exchange_and_bind(&FakeBroker, &user("member@example.com"))
        .await
        .unwrap();

    let state = repository.0.lock().unwrap();
    assert_eq!(state.bindings.len(), 1);
    assert_eq!(state.bindings[0].account_id(), "rox-account");
    assert_eq!(state.bindings[0].handle(), "member");
}

#[tokio::test]
async fn disable_uses_soft_lifecycle_and_reports_gaps_without_reading_billing_flags() {
    let repository = FakeRepo::default();
    let lifecycle = FakeLifecycle::default();
    let service = service(repository.clone(), lifecycle.clone());

    let report = service
        .disable_member(receipt(), user("member@example.com"))
        .await
        .unwrap();

    assert!(report.mail_suspend_gap);
    assert!(report.harness_revoke_gap);
    assert_eq!(report.server_records_revoked, 2);
    assert_eq!(
        lifecycle.0.lock().unwrap().as_slice(),
        ["deactivate:fusion-member"]
    );
    assert_eq!(
        repository.0.lock().unwrap().commits,
        [(true, AuditResult::MailSuspendGap)]
    );

    service
        .enable_member(receipt(), user("member@example.com"))
        .await
        .unwrap();
    assert_eq!(
        lifecycle.0.lock().unwrap().as_slice(),
        ["deactivate:fusion-member", "reactivate:fusion-member"]
    );
    assert_eq!(
        repository.0.lock().unwrap().commits[1],
        (false, AuditResult::Success)
    );
}

#[tokio::test]
async fn disabled_member_is_refused_email_init_and_agent_session_start() {
    let repository = FakeRepo::default();
    repository.0.lock().unwrap().disabled = true;
    let member = user("member@example.com");

    assert!(matches!(
        MemberAccessService::new(repository.clone())
            .ensure_active(&member)
            .await,
        Err(EnterpriseError::MemberDisabled)
    ));
    assert!(matches!(
        RuntimePolicy::new(repository, FakeTeams(Vec::new()))
            .ensure_allowed(member, "opencode")
            .await,
        Err(EnterpriseError::MemberDisabled)
    ));
}

#[tokio::test]
async fn absent_allowlist_does_not_restrict_existing_or_cloud_presets() {
    let policy = RuntimePolicy::new(FakeRepo::default(), FakeTeams(vec![TEAM_ID]));

    for preset in ["opencode", "codex", "codex-cloud", "legacy-local"] {
        policy
            .ensure_allowed(user("member@example.com"), preset)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn present_allowlist_is_exhaustive() {
    let repository = FakeRepo::default();
    repository.0.lock().unwrap().allowlist = Some(RuntimePresetAllowlist {
        preset_ids: vec![RuntimePreset::Opencode],
    });
    let policy = RuntimePolicy::new(repository, FakeTeams(vec![TEAM_ID]));

    policy
        .ensure_allowed(user("member@example.com"), "opencode")
        .await
        .unwrap();
    assert!(matches!(
        policy
            .ensure_allowed(user("member@example.com"), "codex")
            .await,
        Err(EnterpriseError::RuntimePresetDenied)
    ));
}
