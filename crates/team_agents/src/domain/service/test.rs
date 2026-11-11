use std::sync::{Arc, Mutex};

use entity_access::domain::models::EntityType;
use feature_flags::{FlagSnapshot, FlagValue};
use rootcause::Report;

use super::*;
use crate::domain::models::{AgentApiKey, AgentRepo, ComputerSize, ComputerState, RepoToken};

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
    agents: Arc<Mutex<Vec<TeamAgentRecord>>>,
}

impl TeamAgentRepository for FakeRepository {
    type Err = FakeError;

    async fn create_account(&self, account: &NewAgentAccount) -> Result<(), FakeError> {
        self.journal
            .record(format!("account.create {}", account.email));
        self.agents.lock().unwrap().push(TeamAgentRecord {
            user_id: account.user_id.clone(),
            team_id: account.team_id,
            created_by: Some(account.created_by.clone()),
            persona_seed: account.persona_seed.clone(),
            created_at: chrono::DateTime::UNIX_EPOCH,
        });
        Ok(())
    }

    async fn delete_account(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), FakeError> {
        self.journal.record("account.delete");
        self.agents
            .lock()
            .unwrap()
            .retain(|agent| agent.user_id.as_ref() != user_id.as_ref());
        Ok(())
    }

    async fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<TeamAgentRecord>, FakeError> {
        Ok(self
            .agents
            .lock()
            .unwrap()
            .iter()
            .find(|agent| agent.user_id.as_ref() == user_id.as_ref())
            .cloned())
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<TeamAgentRecord>, FakeError> {
        Ok(self
            .agents
            .lock()
            .unwrap()
            .iter()
            .filter(|agent| agent.team_id == team_id)
            .cloned()
            .collect())
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
}

struct FakeApiKeys(Journal);

impl AgentApiKeys for FakeApiKeys {
    async fn mint(&self, _: &MacroUserIdStr<'_>) -> Result<AgentApiKey, TeamAgentError> {
        self.0.record("api_key.mint");
        Ok(AgentApiKey::parse(
            "mak_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_owned(),
        )
        .unwrap())
    }
}

struct FakeRepos(Journal);

impl AgentRepos for FakeRepos {
    async fn create(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
        seed: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        self.0.record(format!("repo.create {}", seed.name));
        Ok(AgentRepo {
            url: "https://git.example.com/ada.git".to_owned(),
            token: RepoToken::generate(),
        })
    }

    async fn delete(&self, _: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        self.0.record("repo.delete");
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeComputers {
    journal: Journal,
    refuse_purchase: bool,
    /// (computer, agent) links made by purchases.
    links: Arc<Mutex<Vec<(ComputerId, MacroUserIdStr<'static>)>>>,
}

impl Computers for FakeComputers {
    async fn purchase(&self, purchase: ComputerPurchase) -> Result<ComputerId, TeamAgentError> {
        self.journal.record(format!(
            "computer.purchase {} by {}",
            purchase.name,
            purchase.created_by.as_ref()
        ));
        if self.refuse_purchase {
            return Err(TeamAgentError::ComputerUnavailable(
                "this computer size is sold out".to_owned(),
            ));
        }
        let id = ComputerId::new_from_uuid(COMPUTER);
        self.links.lock().unwrap().push((id, purchase.agent));
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
            .find(|(_, linked)| linked.as_ref() == agent.as_ref())
            .map(|(id, _)| *id))
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
            .find(|(id, _)| *id == computer_id)
            .map(|(_, agent)| agent.clone()))
    }

    async fn state(&self, _: Uuid, _: ComputerId) -> Result<ComputerState, TeamAgentError> {
        Ok(ComputerState::Ready)
    }

    async fn release(&self, _: Uuid, _: ComputerId) -> Result<(), TeamAgentError> {
        self.journal.record("computer.release");
        Ok(())
    }
}

struct Flags(bool);

impl FeatureFlags for Flags {
    async fn load(&self, _: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        Ok(FlagSnapshot::new([(
            AGENT_TEAMMATES_FLAG.to_owned(),
            FlagValue::Boolean(self.0),
        )]))
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
    Flags,
>;

fn service(flag: bool, computers: FakeComputers) -> (Service, Journal) {
    let journal = computers.journal.clone();
    let repository = FakeRepository {
        journal: journal.clone(),
        agents: Arc::default(),
    };
    let service = TeamAgentServiceImpl::new(
        repository,
        FakeMembership(journal.clone()),
        FakeApiKeys(journal.clone()),
        FakeRepos(journal.clone()),
        computers,
        Some(Flags(flag)),
        Addresses,
    );
    (service, journal)
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
async fn the_list_shows_each_agent_with_its_computers_state() {
    let (service, _) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();

    let listed = service.list(receipt()).await.unwrap();

    assert_eq!(listed.agents.len(), 1);
    assert_eq!(listed.agents[0].user_id, created.user_id);
    assert_eq!(listed.agents[0].status, TeamAgentStatus::Running);
    assert_eq!(listed.agents[0].job_description, "Runs vendor relations.");
}

#[tokio::test]
async fn removing_an_agent_releases_its_computer_first() {
    let (service, journal) = service(true, FakeComputers::default());
    let created = service.create(receipt(), request()).await.unwrap();

    service
        .delete(receipt(), &created.user_id)
        .await
        .expect("the agent is removed");

    assert_eq!(
        journal.entries()[4..],
        [
            "computer.release".to_owned(),
            "team.remove".to_owned(),
            "repo.delete".to_owned(),
            "account.delete".to_owned(),
        ]
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
