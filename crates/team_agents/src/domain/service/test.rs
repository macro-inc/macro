mod inbox;

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use entity_access::domain::models::EntityType;
use feature_flags::{FlagSnapshot, FlagValue};
use rootcause::Report;

use super::*;
use crate::domain::models::{
    AgentApiKey, AgentReady, AgentRepo, ComputerDetails, ComputerSize, ComputerState,
    MAX_NAME_CHARS, RepoToken, VoiceModel,
};

const ADMIN: &str = "macro|admin@example.com";
const TEAM: &str = "0193a1b2-0000-7000-8000-0000000000aa";
const COMPUTER: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00c1);

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn receipt<Permission: RequiredPermission>() -> EntityAccessReceipt<Permission> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(user(ADMIN), TEAM, EntityType::Team)
}

fn request() -> CreateTeamAgent {
    CreateTeamAgent {
        purchase_key: "invite-1".to_owned(),
        name: "  Sam Rivera ".to_owned(),
        job_description: "Runs vendor relations.".to_owned(),
        personality: "Dry, direct, kind.".to_owned(),
        size: ComputerSize::Standard,
        avatar_url: None,
        voice: None,
        inbox: false,
    }
}

/// Every port call, in order.
#[derive(Clone, Default)]
struct Journal(Arc<Mutex<Vec<String>>>);

impl Journal {
    fn record(&self, entry: impl Into<String>) {
        self.0.lock().unwrap().push(entry.into());
    }

    fn entries(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
}

#[derive(Debug, thiserror::Error)]
#[error("fake storage failure")]
struct FakeError;

#[derive(Clone, Default)]
struct FakeRepository {
    journal: Journal,
    /// Each agent with its invite's purchase key.
    agents: Arc<Mutex<Vec<(TeamAgentRecord, PurchaseKey)>>>,
}

impl FakeRepository {
    fn records(&self) -> Vec<TeamAgentRecord> {
        self.agents
            .lock()
            .unwrap()
            .iter()
            .map(|(record, _)| record.clone())
            .collect()
    }
}

impl TeamAgentRepository for FakeRepository {
    type Err = FakeError;

    async fn create_account(&self, account: &NewAgentAccount) -> Result<CreatedAccount, FakeError> {
        let mut agents = self.agents.lock().unwrap();
        // As the unique (team, purchase key) index does.
        if let Some((record, _)) = agents
            .iter()
            .find(|(record, key)| record.team_id == account.team_id && *key == account.purchase_key)
        {
            return Ok(CreatedAccount::AlreadyInvited(Box::new(record.clone())));
        }
        self.journal
            .record(format!("account.create {}", account.email));
        agents.push((
            TeamAgentRecord {
                user_id: account.user_id.clone(),
                team_id: account.team_id,
                created_by: Some(account.created_by.clone()),
                persona_seed: account.persona_seed.clone(),
                created_at: chrono::DateTime::UNIX_EPOCH,
                first_online_at: None,
            },
            account.purchase_key.clone(),
        ));
        Ok(CreatedAccount::Created)
    }

    async fn remove_seat(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), FakeError> {
        self.journal.record("seat.remove");
        self.agents
            .lock()
            .unwrap()
            .retain(|(agent, _)| agent.user_id.as_ref() != user_id.as_ref());
        Ok(())
    }

    async fn delete_account(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), FakeError> {
        self.journal.record("account.delete");
        self.agents
            .lock()
            .unwrap()
            .retain(|(agent, _)| agent.user_id.as_ref() != user_id.as_ref());
        Ok(())
    }

    async fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<TeamAgentRecord>, FakeError> {
        Ok(self
            .records()
            .into_iter()
            .find(|agent| agent.user_id.as_ref() == user_id.as_ref()))
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<TeamAgentRecord>, FakeError> {
        Ok(self
            .records()
            .into_iter()
            .filter(|agent| agent.team_id == team_id)
            .collect())
    }

    async fn mark_online(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), FakeError> {
        self.journal.record("agent.mark_online");
        for agent in self.agents.lock().unwrap().iter_mut() {
            if agent.0.user_id.as_ref() == user_id.as_ref() {
                agent
                    .0
                    .first_online_at
                    .get_or_insert(chrono::DateTime::UNIX_EPOCH);
            }
        }
        Ok(())
    }
}

/// The ready notices sent.
#[derive(Clone, Default)]
struct FakeNotices(Arc<Mutex<Vec<AgentReady>>>);

impl AgentReadyNotices for FakeNotices {
    async fn send(&self, notice: AgentReady) -> Result<(), TeamAgentError> {
        self.0.lock().unwrap().push(notice);
        Ok(())
    }
}

struct FakeMembership(Journal);

impl TeamMembership for FakeMembership {
    async fn add_agent(
        &self,
        _: EntityAccessReceipt<AdminTeamRole>,
        _: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.0.record("team.add");
        Ok(())
    }

    async fn undo_add_agent(
        &self,
        _: EntityAccessReceipt<AdminTeamRole>,
        _: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.0.record("team.undo");
        Ok(())
    }

    async fn remove_agent(
        &self,
        _: EntityAccessReceipt<AdminTeamRole>,
        _: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.0.record("team.remove");
        Ok(())
    }

    async fn take_back_agent(
        &self,
        team_id: Uuid,
        _: &MacroUserIdStr<'_>,
        removed_by: MacroUserIdStr<'static>,
    ) -> Result<(), TeamAgentError> {
        self.0.record(format!(
            "team.take_back {team_id} by {}",
            removed_by.as_ref()
        ));
        Ok(())
    }
}

struct FakeApiKeys(Journal);

impl AgentApiKeys for FakeApiKeys {
    async fn revoke_all(&self, _: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        self.0.record("api_key.revoke_all");
        Ok(())
    }

    async fn mint(&self, _: &MacroUserIdStr<'_>) -> Result<AgentApiKey, TeamAgentError> {
        self.0.record("api_key.mint");
        Ok(AgentApiKey::parse(
            "mak_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_owned(),
        )
        .unwrap())
    }
}

/// A seed with this name fails its repo create after the call went out, as
/// when the answer is lost: the repo may exist.
const LOST_REPO_ANSWER: &str = "Lost Answer";

struct FakeRepos(Journal);

impl AgentRepos for FakeRepos {
    async fn create(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
        seed: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        self.0.record(format!("repo.create {}", seed.name));
        if seed.name == LOST_REPO_ANSWER {
            return Err(TeamAgentError::RepoUnavailable(
                rootcause::Report::new(std::io::Error::other("answer lost")).into_dynamic(),
            ));
        }
        Ok(AgentRepo {
            url: "https://git.example.com/ada.git".to_owned(),
            token: RepoToken::generate(),
        })
    }

    async fn delete(&self, _: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        self.0.record("repo.delete");
        Ok(())
    }

    async fn voice(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
    ) -> Result<Option<VoiceModel>, TeamAgentError> {
        let committed = self
            .0
            .entries()
            .iter()
            .rev()
            .find_map(|entry| entry.strip_prefix("repo.set_voice ").map(str::to_owned));
        Ok(committed.map(|model| VoiceModel::parse(model).unwrap()))
    }

    async fn set_voice(
        &self,
        _: &MacroUserIdStr<'_>,
        team_id: Uuid,
        voice: &VoiceModel,
    ) -> Result<(), TeamAgentError> {
        assert_eq!(team_id.to_string(), TEAM);
        self.0.record(format!("repo.set_voice {voice}"));
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeComputers {
    journal: Journal,
    refuse_purchase: bool,
    /// Its computer was bought before agents reported online, so its first
    /// start waits on nothing.
    bought_before_online_reports: bool,
    /// The computers rollout doesn't include the buyer.
    rollout_off: bool,
    /// (purchase key, computer, agent) links made by purchases.
    links: Arc<Mutex<Vec<(PurchaseKey, ComputerId, MacroUserIdStr<'static>)>>>,
}

impl Computers for FakeComputers {
    async fn purchase(&self, purchase: ComputerPurchase) -> Result<ComputerId, TeamAgentError> {
        self.journal.record(format!(
            "computer.purchase {} by {}",
            purchase.name.as_str(),
            purchase.created_by.as_ref()
        ));
        if self.refuse_purchase {
            return Err(TeamAgentError::ComputerUnavailable(
                "this computer size is sold out".to_owned(),
            ));
        }
        let mut links = self.links.lock().unwrap();
        // As hosted_runtimes does: a repeated key returns the computer the
        // first purchase made, still linked to the first purchase's agent.
        if let Some((_, id, _)) = links
            .iter()
            .find(|(key, _, _)| *key == purchase.purchase_key)
        {
            return Ok(*id);
        }
        let id = ComputerId::new_from_uuid(COMPUTER);
        links.push((purchase.purchase_key, id, purchase.agent));
        Ok(id)
    }

    async fn computer_for_agent(
        &self,
        _: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<ComputerId>, TeamAgentError> {
        Ok(self
            .links
            .lock()
            .unwrap()
            .iter()
            .find(|(_, _, linked)| linked.as_ref() == agent.as_ref())
            .map(|(_, id, _)| *id))
    }

    async fn agent_of(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<MacroUserIdStr<'static>>, TeamAgentError> {
        Ok(self
            .links
            .lock()
            .unwrap()
            .iter()
            .find(|(_, id, _)| *id == computer_id)
            .map(|(_, _, agent)| agent.clone()))
    }

    async fn require_purchase_rollout(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<(), TeamAgentError> {
        if self.rollout_off {
            return Err(TeamAgentError::NotEnabled);
        }
        Ok(())
    }

    async fn state(&self, _: Uuid, _: ComputerId) -> Result<ComputerState, TeamAgentError> {
        Ok(if self.bought_before_online_reports {
            ComputerState::Ready
        } else {
            ComputerState::AwaitingAgent
        })
    }

    async fn details(&self, _: Uuid, _: ComputerId) -> Result<ComputerDetails, TeamAgentError> {
        Ok(ComputerDetails {
            name: "Sam Rivera".to_owned(),
            harness_id: None,
        })
    }

    async fn release(&self, _: Uuid, _: ComputerId) -> Result<(), TeamAgentError> {
        self.journal.record("computer.release");
        Ok(())
    }

    async fn agent_online(&self, _: Uuid, _: ComputerId) -> Result<(), TeamAgentError> {
        self.journal.record("computer.agent_online");
        Ok(())
    }
}

/// Each agent follows the admin who invited it; with no creator, the fake
/// has no team owner to fall back on.
impl agent_credentials::AgentCreators for FakeRepository {
    async fn creator_of(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<MacroUserIdStr<'static>>, Report> {
        Ok(self
            .agents
            .lock()
            .unwrap()
            .iter()
            .find(|(record, _)| record.user_id.as_ref() == agent.as_ref())
            .and_then(|(record, _)| record.created_by.clone()))
    }
}

/// The rollout for people, which a test can turn off after an invite. Like
/// PostHog's targeting, it never matches an agent's own account.
#[derive(Clone)]
struct Flags(Arc<AtomicBool>, Arc<AtomicBool>);

impl Flags {
    fn set(&self, on: bool) {
        self.0.store(on, Ordering::SeqCst);
    }

    /// Turn only `enable-agent-inboxes` on or off.
    fn set_inboxes(&self, on: bool) {
        self.1.store(on, Ordering::SeqCst);
    }
}

impl FeatureFlags for Flags {
    async fn load(&self, user: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        let agent = user.as_ref().ends_with(AGENT_EMAIL_DOMAIN);
        let on = !agent && self.0.load(Ordering::SeqCst);
        Ok(FlagSnapshot::new([
            (AGENT_TEAMMATES_FLAG.to_owned(), FlagValue::Boolean(on)),
            (
                AGENT_INBOXES_FLAG.to_owned(),
                FlagValue::Boolean(on && self.1.load(Ordering::SeqCst)),
            ),
        ]))
    }
}

struct Addresses;

impl EnrollmentEnvironment for Addresses {
    fn environment(&self) -> Result<Vec<(&'static str, String)>, TeamAgentError> {
        Ok(vec![(
            "MACRO_GATEWAY",
            "https://gateway.example.com".to_owned(),
        )])
    }
}

type Service = TeamAgentServiceImpl<
    FakeRepository,
    FakeMembership,
    FakeApiKeys,
    FakeRepos,
    FakeComputers,
    FakeRepository,
    Flags,
    FakeNotices,
>;

fn service(flag: bool, computers: FakeComputers) -> (Service, Journal) {
    let (service, journal, _) = service_with_flags(flag, computers);
    (service, journal)
}

fn service_with_flags(flag: bool, computers: FakeComputers) -> (Service, Journal, Flags) {
    let flags = Flags(
        Arc::new(AtomicBool::new(flag)),
        Arc::new(AtomicBool::new(true)),
    );
    let journal = computers.journal.clone();
    let repository = FakeRepository {
        journal: journal.clone(),
        agents: Arc::default(),
    };
    let service = TeamAgentServiceImpl::new(
        repository.clone(),
        FakeMembership(journal.clone()),
        FakeApiKeys(journal.clone()),
        FakeRepos(journal.clone()),
        computers,
        repository,
        Some(flags.clone()),
        FakeNotices::default(),
        Addresses,
    );
    (service, journal, flags)
}

#[tokio::test]
async fn inviting_an_agent_creates_its_account_seat_repo_and_computer_in_order() {
    let (service, journal) = service(true, FakeComputers::default());

    let agent = service
        .create(receipt(), request())
        .await
        .expect("the invite succeeds");

    assert_eq!(agent.name, "Sam Rivera");
    assert_eq!(agent.status, TeamAgentStatus::Provisioning);
    assert_eq!(agent.computer_id, Some(ComputerId::new_from_uuid(COMPUTER)));
    assert!(agent.user_id.as_ref().starts_with("macro|sam-rivera-"));
    assert!(agent.user_id.as_ref().ends_with("@agents.macro.invalid"));
    let entries = journal.entries();
    assert_eq!(entries.len(), 4);
    assert!(entries[0].starts_with("account.create sam-rivera-"));
    assert_eq!(entries[1], "team.add");
    assert_eq!(entries[2], "repo.create Sam Rivera");
    assert_eq!(
        entries[3],
        "computer.purchase Sam Rivera by macro|admin@example.com"
    );
}

#[tokio::test]
async fn a_retried_invite_returns_the_first_agent_without_a_second_account() {
    let (service, journal) = service(true, FakeComputers::default());

    // A double click, or a retry after the first answer was lost: the same
    // Invite dialog sends the same purchase key twice.
    let first = service.create(receipt(), request()).await.unwrap();
    let retried = service.create(receipt(), request()).await.unwrap();

    assert_eq!(retried.user_id, first.user_id);
    assert_eq!(retried.computer_id, first.computer_id);
    let listed = service.list(receipt()).await.unwrap();
    assert_eq!(listed.agents.len(), 1);
    // Up, but the agent hasn't reported online.
    assert_eq!(listed.agents[0].status, TeamAgentStatus::Starting);
    let entries = journal.entries();
    let made = |prefix: &str| {
        entries
            .iter()
            .filter(|entry| entry.starts_with(prefix))
            .count()
    };
    assert_eq!(made("account.create"), 1);
    assert_eq!(made("team.add"), 1);
    assert_eq!(made("repo.create"), 1);
    assert_eq!(made("computer.purchase"), 1);
}

#[tokio::test]
async fn a_repeated_invite_before_the_first_bought_its_computer_is_refused_and_changes_nothing() {
    let (service, journal) = service(true, FakeComputers::default());
    // The first request has made the account and is still joining it to the
    // team, making its repo or buying its computer; it may yet take it back.
    service.repository.agents.lock().unwrap().push((
        TeamAgentRecord {
            user_id: user("macro|sam-rivera-abc123@agents.macro.invalid"),
            team_id: Uuid::parse_str(TEAM).unwrap(),
            created_by: Some(user(ADMIN)),
            persona_seed: PersonaSeed {
                creator_id: Some(user(ADMIN)),
                name: "Sam Rivera".to_owned(),
                job_description: "Runs vendor relations.".to_owned(),
                personality: "Dry, direct, kind.".to_owned(),
                voice: None,
            },
            created_at: chrono::DateTime::UNIX_EPOCH,
            first_online_at: None,
        },
        PurchaseKey::try_new("invite-1".to_owned()).unwrap(),
    ));

    let result = service.create(receipt(), request()).await;

    assert!(matches!(result, Err(TeamAgentError::InviteInProgress)));
    assert!(journal.entries().is_empty());
    assert_eq!(service.repository.records().len(), 1);
}

#[tokio::test]
async fn with_the_flag_off_nothing_is_created() {
    let (service, journal) = service(false, FakeComputers::default());

    let result = service.create(receipt(), request()).await;

    assert!(matches!(result, Err(TeamAgentError::NotEnabled)));
    assert!(journal.entries().is_empty());
}

#[tokio::test]
async fn a_refused_purchase_takes_back_the_repo_seat_and_account() {
    let (service, journal) = service(
        true,
        FakeComputers {
            refuse_purchase: true,
            ..FakeComputers::default()
        },
    );

    let result = service.create(receipt(), request()).await;

    assert!(matches!(
        result,
        Err(TeamAgentError::ComputerUnavailable(_))
    ));
    let entries = journal.entries();
    assert_eq!(
        entries[3..],
        [
            "computer.purchase Sam Rivera by macro|admin@example.com".to_owned(),
            "repo.delete".to_owned(),
            "team.undo".to_owned(),
            "account.delete".to_owned(),
        ]
    );
    assert!(service.repository.agents.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_repo_create_whose_answer_is_lost_is_still_undone() {
    let (service, journal) = service(true, FakeComputers::default());

    let result = service
        .create(
            receipt(),
            CreateTeamAgent {
                name: LOST_REPO_ANSWER.to_owned(),
                ..request()
            },
        )
        .await;

    assert!(matches!(result, Err(TeamAgentError::RepoUnavailable(_))));
    let entries = journal.entries();
    assert_eq!(
        entries[entries.len() - 4..],
        [
            format!("repo.create {LOST_REPO_ANSWER}"),
            "repo.delete".to_owned(),
            "team.undo".to_owned(),
            "account.delete".to_owned(),
        ]
    );
}

/// Agent teammates on but computers off for the admin: refused before an
/// account, seat or repository is made, not created and then undone.
#[tokio::test]
async fn a_buyer_outside_the_computers_rollout_is_refused_before_anything_is_created() {
    let (service, journal) = service(
        true,
        FakeComputers {
            rollout_off: true,
            ..FakeComputers::default()
        },
    );

    let result = service.create(receipt(), request()).await;

    assert!(matches!(result, Err(TeamAgentError::NotEnabled)));
    assert!(journal.entries().is_empty());
}

#[tokio::test]
async fn an_empty_name_is_refused_before_anything_is_created() {
    let (service, journal) = service(true, FakeComputers::default());

    let result = service
        .create(
            receipt(),
            CreateTeamAgent {
                name: "   ".to_owned(),
                ..request()
            },
        )
        .await;

    assert!(matches!(result, Err(TeamAgentError::InvalidName)));
    assert!(journal.entries().is_empty());
}

#[tokio::test]
async fn an_overlong_name_is_refused_before_anything_is_created() {
    let (service, journal) = service(true, FakeComputers::default());

    let result = service
        .create(
            receipt(),
            CreateTeamAgent {
                name: "a".repeat(MAX_NAME_CHARS + 1),
                ..request()
            },
        )
        .await;

    assert!(matches!(result, Err(TeamAgentError::InvalidName)));
    assert!(journal.entries().is_empty());
}

#[tokio::test]
async fn an_invalid_purchase_key_is_refused_before_anything_is_created() {
    for purchase_key in ["", "has space", &"k".repeat(129)] {
        let (service, journal) = service(true, FakeComputers::default());

        let result = service
            .create(
                receipt(),
                CreateTeamAgent {
                    purchase_key: purchase_key.to_owned(),
                    ..request()
                },
            )
            .await;

        assert!(
            matches!(result, Err(TeamAgentError::InvalidPurchaseKey)),
            "{purchase_key:?}"
        );
        assert!(journal.entries().is_empty(), "{purchase_key:?}");
    }
}

#[tokio::test]
async fn an_invite_with_only_a_name_leaves_the_role_for_the_agent_to_ask() {
    let (service, _) = service(true, FakeComputers::default());

    let created = service
        .create(
            receipt(),
            CreateTeamAgent {
                job_description: "  ".to_owned(),
                personality: String::new(),
                ..request()
            },
        )
        .await
        .unwrap();

    assert_eq!(created.name, "Sam Rivera");
    assert_eq!(created.job_description, "");
    assert_eq!(created.personality, "");
}

#[tokio::test]
async fn a_profile_over_the_limit_is_refused_before_anything_is_created() {
    let (service, journal) = service(true, FakeComputers::default());

    let result = service
        .create(
            receipt(),
            CreateTeamAgent {
                personality: "x".repeat(MAX_PROFILE_CHARS + 1),
                ..request()
            },
        )
        .await;

    assert!(matches!(result, Err(TeamAgentError::InvalidProfile)));
    assert!(journal.entries().is_empty());
}

#[tokio::test]
async fn the_list_shows_each_agent_with_its_computers_state() {
    let (service, _) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();

    let listed = service.list(receipt()).await.unwrap();

    assert_eq!(listed.agents.len(), 1);
    assert_eq!(listed.agents[0].user_id, created.user_id);
    assert_eq!(listed.agents[0].job_description, "Runs vendor relations.");
}

/// The agent's own credential on its team, as its online report carries.
fn agent_receipt(agent: &MacroUserIdStr<'static>) -> EntityAccessReceipt<MemberTeamRole> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        agent.clone(),
        TEAM,
        EntityType::Team,
    )
}

#[tokio::test]
async fn an_up_computer_runs_its_agent_only_once_the_agent_reports_online() {
    let (service, _) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();

    // The computer is up (macrod connected), but the agent hasn't started.
    let before = service.list(receipt()).await.unwrap();
    assert_eq!(before.agents[0].status, TeamAgentStatus::Starting);
    assert!(service.notices.0.lock().unwrap().is_empty());

    service
        .agent_online(agent_receipt(&created.user_id))
        .await
        .expect("the agent reports online");

    let after = service.list(receipt()).await.unwrap();
    assert_eq!(after.agents[0].status, TeamAgentStatus::Running);
    assert_eq!(
        *service.notices.0.lock().unwrap(),
        [AgentReady {
            computer_id: ComputerId::new_from_uuid(COMPUTER),
            team_id: Uuid::parse_str(TEAM).unwrap(),
            computer: ComputerDetails {
                name: "Sam Rivera".to_owned(),
                harness_id: None,
            },
            inviter: user(ADMIN),
            agent: created.user_id,
            agent_name: "Sam Rivera".to_owned(),
        }]
    );
}

/// An agent created while an older release ran never reports and was not
/// backfilled; its computer waits on nothing, so it reads as running rather
/// than starting forever.
#[tokio::test]
async fn an_agent_whose_computer_waits_on_nothing_runs_once_the_computer_is_up() {
    let (service, _) = service(
        true,
        FakeComputers {
            bought_before_online_reports: true,
            ..FakeComputers::default()
        },
    );
    service.create(receipt(), request()).await.unwrap();

    let listed = service.list(receipt()).await.unwrap();

    assert_eq!(listed.agents[0].status, TeamAgentStatus::Running);
}

#[tokio::test]
async fn only_the_first_online_report_tells_the_inviter() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();

    service
        .agent_online(agent_receipt(&created.user_id))
        .await
        .unwrap();
    // A restart, or the agent's retry after a lost answer.
    service
        .agent_online(agent_receipt(&created.user_id))
        .await
        .unwrap();

    assert_eq!(service.notices.0.lock().unwrap().len(), 1);
    let marks = journal
        .entries()
        .iter()
        .filter(|entry| *entry == "agent.mark_online")
        .count();
    assert_eq!(marks, 1);
    // Each report tells the computer, so one that missed the first catches up.
    let told = journal
        .entries()
        .iter()
        .filter(|entry| *entry == "computer.agent_online")
        .count();
    assert_eq!(told, 2);
}

/// The computer's first start ends with the agent's report, before the
/// stamp, so a failed hand-off is retried by the agent's next report.
#[tokio::test]
async fn the_first_online_report_ends_the_computers_first_start_before_the_stamp() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();

    service
        .agent_online(agent_receipt(&created.user_id))
        .await
        .unwrap();

    let entries = journal.entries();
    let told = entries
        .iter()
        .position(|entry| entry == "computer.agent_online")
        .expect("the computer hears the agent is online");
    let stamped = entries
        .iter()
        .position(|entry| entry == "agent.mark_online")
        .unwrap();
    assert!(told < stamped);
}

#[tokio::test]
async fn only_an_agent_of_the_team_can_report_itself_online() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();
    let before = journal.entries().len();
    let other_team = EntityAccessReceipt::dangerously_assert_authenticated_user(
        created.user_id.clone(),
        "0193a1b2-0000-7000-8000-0000000000bb",
        EntityType::Team,
    );

    assert!(matches!(
        service.agent_online(receipt()).await,
        Err(TeamAgentError::NotFound)
    ));
    assert!(matches!(
        service.agent_online(other_team).await,
        Err(TeamAgentError::NotFound)
    ));

    assert_eq!(journal.entries().len(), before);
    assert!(service.notices.0.lock().unwrap().is_empty());
    assert_eq!(
        service.list(receipt()).await.unwrap().agents[0].status,
        TeamAgentStatus::Starting
    );
}

#[tokio::test]
async fn removing_an_agent_deactivates_it_and_keeps_its_account() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();

    service
        .delete(receipt(), &created.user_id)
        .await
        .expect("the agent is removed");

    // The computer goes first, so nothing keeps running as the agent. The
    // account, and all it owns (docs shared with the team, threads,
    // routines), stays: only its seat, keys, repo token and membership go.
    assert_eq!(
        journal.entries()[4..],
        [
            "computer.release".to_owned(),
            "api_key.revoke_all".to_owned(),
            "repo.create Sam Rivera".to_owned(),
            "team.remove".to_owned(),
            "seat.remove".to_owned(),
        ]
    );
    assert!(service.list(receipt()).await.unwrap().agents.is_empty());
}

/// A failed first start takes the agent back with no admin: keys, repository,
/// membership (removed in its inviter's name) and seat, its account kept.
/// Taking it back again, or from another team, does nothing.
#[tokio::test]
async fn an_undone_invite_takes_the_agent_back_and_again_is_a_no_op() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();
    let team_id: Uuid = TEAM.parse().unwrap();

    service
        .undo_invite(Uuid::nil(), &created.user_id)
        .await
        .unwrap();
    assert_eq!(journal.entries().len(), 4);

    service
        .undo_invite(team_id, &created.user_id)
        .await
        .unwrap();
    assert_eq!(
        journal.entries()[4..],
        [
            "api_key.revoke_all".to_owned(),
            "repo.delete".to_owned(),
            format!("team.take_back {team_id} by macro|admin@example.com"),
            "seat.remove".to_owned(),
        ]
    );
    assert!(service.list(receipt()).await.unwrap().agents.is_empty());

    service
        .undo_invite(team_id, &created.user_id)
        .await
        .unwrap();
    assert_eq!(journal.entries().len(), 8);
}

#[tokio::test]
async fn an_admin_can_remove_an_agent_with_the_rollout_off_so_billing_can_always_stop() {
    let (service, journal, flags) = service_with_flags(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();
    flags.set(false);

    service
        .delete(receipt(), &created.user_id)
        .await
        .expect("removal isn't gated");

    assert!(journal.entries().contains(&"computer.release".to_owned()));
}

#[tokio::test]
async fn the_invite_voice_seeds_the_repo_and_admins_change_it_later() {
    let (service, journal) = service(true, FakeComputers::default());
    let thalia = VoiceModel::parse("aura-2-thalia-en").unwrap();
    let created = service
        .create(
            receipt(),
            CreateTeamAgent {
                voice: Some(thalia.clone()),
                ..request()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        service.repository.agents.lock().unwrap()[0]
            .0
            .persona_seed
            .voice,
        Some(thalia)
    );
    assert!(matches!(
        service.voice(receipt(), &created.user_id).await,
        Err(TeamAgentError::NoVoice)
    ));

    let arcas = AgentVoice {
        model: VoiceModel::parse("aura-2-arcas-en").unwrap(),
    };
    assert_eq!(
        service
            .set_voice(receipt(), &created.user_id, arcas.clone())
            .await
            .unwrap(),
        arcas
    );
    assert_eq!(
        service.voice(receipt(), &created.user_id).await.unwrap(),
        arcas
    );
    assert_eq!(
        journal.entries().last().unwrap(),
        "repo.set_voice aura-2-arcas-en"
    );
}

#[tokio::test]
async fn voices_of_other_teams_agents_or_without_the_rollout_are_refused() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();
    let other_team = EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(ADMIN),
        "0193a1b2-0000-7000-8000-0000000000bb",
        EntityType::Team,
    );
    let voice = AgentVoice {
        model: VoiceModel::parse("aura-2-arcas-en").unwrap(),
    };

    assert!(matches!(
        service.voice(other_team.clone(), &created.user_id).await,
        Err(TeamAgentError::NotFound)
    ));
    assert!(matches!(
        service
            .set_voice(other_team, &created.user_id, voice.clone())
            .await,
        Err(TeamAgentError::NotFound)
    ));
    let (closed, _) = self::service(false, FakeComputers::default());
    assert!(matches!(
        closed.set_voice(receipt(), &created.user_id, voice).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(
        !journal
            .entries()
            .iter()
            .any(|entry| entry.starts_with("repo.set_voice"))
    );
}

#[tokio::test]
async fn an_agents_computer_enrolls_with_fresh_credentials_and_its_addresses() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();

    let enrollment = service
        .issue_enrollment(
            ComputerId::new_from_uuid(COMPUTER),
            EnrollmentGeneration::new(1),
        )
        .await
        .unwrap()
        .expect("the computer runs an agent");

    assert_eq!(enrollment.agent_user_id, created.user_id);
    let env: BTreeMap<&str, &str> = enrollment
        .env
        .expose()
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    assert_eq!(env["MACRO_GATEWAY"], "https://gateway.example.com");
    assert_eq!(
        env["MACRO_API_KEY"],
        "mak_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    assert_eq!(
        env["ANTHROPIC_AUTH_TOKEN"],
        "mak_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    assert_eq!(env["MACRO_AGENT_USER_ID"], created.user_id.as_ref());
    assert_eq!(env["MACRO_TEAM_ID"], TEAM);
    assert_eq!(env["MACRO_AGENT_NAME"], "Sam Rivera");
    assert_eq!(env["MACRO_COMPUTER_ID"], COMPUTER.to_string());
    assert_eq!(env["MACRO_REPO_URL"], "https://git.example.com/ada.git");
    assert!(env["MACRO_REPO_TOKEN"].len() > 20);
    assert_eq!(
        journal.entries()[4..],
        [
            "api_key.mint".to_owned(),
            "repo.create Sam Rivera".to_owned()
        ]
    );
}

#[tokio::test]
async fn with_the_rollout_off_for_its_creator_an_agents_computer_enrolls_without_its_credentials() {
    let (service, journal, flags) = service_with_flags(true, FakeComputers::default());
    service.create(receipt(), request()).await.unwrap();
    flags.set(false);
    let before = journal.entries().len();

    let enrollment = service
        .issue_enrollment(
            ComputerId::new_from_uuid(COMPUTER),
            EnrollmentGeneration::new(1),
        )
        .await
        .unwrap();

    assert_eq!(enrollment, None);
    // Nothing minted: no key, no repo token.
    assert_eq!(journal.entries().len(), before);
}

#[tokio::test]
async fn an_agent_with_no_one_to_follow_enrolls_without_its_credentials() {
    let (service, journal) = service(true, FakeComputers::default());
    service.create(receipt(), request()).await.unwrap();
    // No creator, and no team owner to fall back on.
    service.repository.agents.lock().unwrap()[0].0.created_by = None;
    let before = journal.entries().len();

    let enrollment = service
        .issue_enrollment(
            ComputerId::new_from_uuid(COMPUTER),
            EnrollmentGeneration::new(1),
        )
        .await
        .unwrap();

    assert_eq!(enrollment, None);
    assert_eq!(journal.entries().len(), before);
}

#[tokio::test]
async fn a_computer_without_an_agent_enrolls_without_one() {
    let (service, journal) = service(true, FakeComputers::default());

    let enrollment = service
        .issue_enrollment(
            ComputerId::new_from_uuid(COMPUTER),
            EnrollmentGeneration::new(1),
        )
        .await
        .unwrap();

    assert_eq!(enrollment, None);
    assert!(journal.entries().is_empty());
}

#[test]
fn slugs_are_lowercase_words_joined_by_dashes() {
    assert_eq!(slug("  Sam Rivera "), "sam-rivera");
    assert_eq!(slug("Ünïcode only"), "n-code-only");
    assert_eq!(slug("!!!"), "agent");
    assert_eq!(
        slug("a very long agent name that goes on"),
        "a-very-long-agent-name-t"
    );
}

#[tokio::test]
async fn with_the_rollout_off_the_list_and_an_agents_voice_are_refused() {
    let (service, journal, flags) = service_with_flags(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();
    flags.set(false);
    let before = journal.entries().len();

    assert!(matches!(
        service.list(receipt()).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service.voice(receipt(), &created.user_id).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert_eq!(journal.entries().len(), before);
}

/// An invited agent whose account exists but whose computer isn't bought yet.
fn agent_without_a_computer(created_at: chrono::DateTime<chrono::Utc>) -> TeamAgentRecord {
    TeamAgentRecord {
        user_id: user("macro|sam-rivera-abc123@agents.macro.invalid"),
        team_id: Uuid::parse_str(TEAM).unwrap(),
        created_by: Some(user(ADMIN)),
        persona_seed: PersonaSeed {
            creator_id: Some(user(ADMIN)),
            name: "Sam Rivera".to_owned(),
            job_description: "Runs vendor relations.".to_owned(),
            personality: "Dry, direct, kind.".to_owned(),
            voice: None,
        },
        created_at,
        first_online_at: None,
    }
}

/// The invite reserves the computer in the same request that made the
/// account, so a computer missing just after the invite is still coming.
#[tokio::test]
async fn an_agent_invited_moments_ago_without_a_computer_yet_is_provisioning() {
    let (service, _) = service(true, FakeComputers::default());
    service.repository.agents.lock().unwrap().push((
        agent_without_a_computer(chrono::Utc::now() - chrono::Duration::minutes(1)),
        PurchaseKey::try_new("invite-1".to_owned()).unwrap(),
    ));

    let listed = service.list(receipt()).await.unwrap();

    assert_eq!(listed.agents[0].status, TeamAgentStatus::Provisioning);
}

/// Past [`crate::domain::models::ORPHANED_INVITE_AFTER`], the invite that
/// should have bought the computer died.
#[tokio::test]
async fn an_agent_still_without_a_computer_long_after_its_invite_failed() {
    let (service, _) = service(true, FakeComputers::default());
    service.repository.agents.lock().unwrap().push((
        agent_without_a_computer(chrono::Utc::now() - chrono::Duration::minutes(11)),
        PurchaseKey::try_new("invite-1".to_owned()).unwrap(),
    ));

    let listed = service.list(receipt()).await.unwrap();

    assert_eq!(listed.agents[0].status, TeamAgentStatus::Failed);
}
