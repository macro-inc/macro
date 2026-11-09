use crate::domain::models::{
    AgentApiKey, AgentRepo, PersonaConfigKey, PersonaOsUser, StripePriceId, SystemdUnitName,
};
use agent_credentials::RepoToken;
use hosted_runtimes::domain::ids::ComputerId;

use crate::domain::mail::{MailMessageId, MailboxId};
use std::sync::{Arc, Mutex};

use chrono::{TimeZone, Utc};
use entity_access::domain::models::EntityType;
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};

use super::*;
use crate::domain::models::{
    BillingInterval, ComputerQuote, ComputerStatus, EmailMessages, Mailbox, SeatQuote,
    SetupProgress, SetupStep, SubscriptionItem,
};

const TEAM_ID: &str = "0190f1b4-6c2e-7b7a-9a4c-1d2e3f405060";
const OTHER_TEAM_ID: &str = "0190f1b4-6c2e-7b7a-9a4c-1d2e3f405061";
const COMPUTER_ID: &str = "0190f1b4-6c2e-7b7a-9a4c-00000000c0de";
const ADMIN: &str = "macro|admin@example.com";
const AGENT: &str = "macro|sam@agents.example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id)
        .map(MacroUserIdStr::into_owned)
        .expect("valid user id")
}

/// The calls every fake made, in order, and the one step that fails.
#[derive(Default)]
struct Journal {
    steps: Mutex<Vec<&'static str>>,
    fail_at: Option<&'static str>,
}

impl Journal {
    fn record(&self, step: &'static str) -> Result<(), TeamAgentError> {
        self.steps.lock().expect("lock").push(step);

        if self.fail_at == Some(step) {
            return Err(TeamAgentError::internal_message(format!("{step} failed")));
        }

        Ok(())
    }

    fn steps(&self) -> Vec<&'static str> {
        self.steps.lock().expect("lock").clone()
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct FakeRepositoryError(String);

struct StoredAgent {
    account: NewAgentAccount,
    computer_id: Option<ComputerId>,
    status: TeamAgentStatus,
    status_reason: Option<String>,
}

struct FakeRepository {
    owner_verified_email: Option<String>,
    admin_verified_email: Option<String>,
    journal: Arc<Journal>,
    agents: Mutex<Vec<StoredAgent>>,
    get_calls: Mutex<usize>,
}

impl FakeRepository {
    fn fail(&self, step: &'static str) -> Result<(), FakeRepositoryError> {
        self.journal
            .record(step)
            .map_err(|error| FakeRepositoryError(error.to_string()))
    }
}

impl TeamAgentRepository for FakeRepository {
    type Err = FakeRepositoryError;

    async fn verified_email(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<String>, Self::Err> {
        if user_id.as_ref() == "macro|admin@example.com" {
            Ok(self.admin_verified_email.clone())
        } else {
            Ok(self.owner_verified_email.clone())
        }
    }

    async fn create_account(&self, account: &NewAgentAccount) -> Result<(), Self::Err> {
        self.fail("account.create")?;
        self.agents.lock().expect("lock").push(StoredAgent {
            account: account.clone(),
            computer_id: None,
            status: TeamAgentStatus::Provisioning,
            status_reason: None,
        });
        Ok(())
    }

    async fn delete_account(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), Self::Err> {
        self.fail("account.delete")?;
        self.agents
            .lock()
            .expect("lock")
            .retain(|agent| agent.account.user_id.as_ref() != user_id.as_ref());
        Ok(())
    }

    async fn get(&self, user_id: &MacroUserIdStr<'_>) -> Result<Option<TeamAgent>, Self::Err> {
        *self.get_calls.lock().unwrap() += 1;
        Ok(self
            .agents
            .lock()
            .expect("lock")
            .iter()
            .find(|agent| agent.account.user_id.as_ref() == user_id.as_ref())
            .map(|agent| TeamAgent {
                user_id: agent.account.user_id.clone(),
                team_id: agent.account.team_id,
                name: agent.account.name.clone(),
                email: agent.account.email.clone(),
                created_by: Some(agent.account.created_by.clone()),
                computer_id: agent.computer_id,
                status: agent.status,
                status_reason: agent.status_reason.clone(),
                setup: None,
                last_turn_at: None,
                retryable: false,
                payment: None,
                created_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
            }))
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<TeamAgent>, Self::Err> {
        let user_ids: Vec<MacroUserIdStr<'static>> = self
            .agents
            .lock()
            .expect("lock")
            .iter()
            .filter(|agent| agent.account.team_id == team_id)
            .map(|agent| agent.account.user_id.clone())
            .collect();

        let mut agents = Vec::new();
        for user_id in user_ids {
            agents.extend(self.get(&user_id).await?);
        }
        Ok(agents)
    }

    async fn persona_seed(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<PersonaSeed>, Self::Err> {
        Ok(self
            .agents
            .lock()
            .unwrap()
            .iter()
            .find(|agent| agent.account.user_id.as_ref() == user_id.as_ref())
            .map(|agent| agent.account.persona_seed.clone()))
    }

    async fn mailbox_id(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<MailboxId>, Self::Err> {
        Ok(self
            .agents
            .lock()
            .expect("lock")
            .iter()
            .find(|agent| agent.account.user_id.as_ref() == user_id.as_ref())
            .and_then(|agent| agent.account.mailbox_id.clone()))
    }

    async fn set_computer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        computer_id: ComputerId,
    ) -> Result<(), Self::Err> {
        self.fail("account.set_computer")?;
        for agent in self.agents.lock().expect("lock").iter_mut() {
            if agent.account.user_id.as_ref() == user_id.as_ref() {
                agent.computer_id = Some(computer_id);
            }
        }
        Ok(())
    }

    async fn set_status(
        &self,
        user_id: &MacroUserIdStr<'_>,
        status: TeamAgentStatus,
        reason: Option<&str>,
    ) -> Result<(), Self::Err> {
        self.fail("account.set_status")?;
        for agent in self.agents.lock().expect("lock").iter_mut() {
            if agent.account.user_id.as_ref() == user_id.as_ref() {
                agent.status = status;
                agent.status_reason = reason.map(str::to_string);
            }
        }
        Ok(())
    }
}

struct FakeMembership {
    journal: Arc<Journal>,
    seat: Option<SeatQuote>,
}

impl TeamMembership for FakeMembership {
    async fn team_admins(
        &self,
        _team_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, TeamAgentError> {
        Ok(vec![
            user("macro|owner@example.com"),
            user("macro|admin@example.com"),
        ])
    }

    async fn add_agent(
        &self,
        _receipt: EntityAccessReceipt<AdminTeamRole>,
        _agent_user_id: &MacroUserIdStr<'_>,
        included: bool,
    ) -> Result<Option<SubscriptionItem>, TeamAgentError> {
        self.journal.record("team.add")?;
        if included {
            return Ok(None);
        }
        Ok(self.seat.as_ref().map(|_| SubscriptionItem {
            price_id: StripePriceId::parse("price_seat").expect("price"),
            quantity: 1,
        }))
    }

    async fn undo_add_agent(
        &self,
        _receipt: EntityAccessReceipt<AdminTeamRole>,
        _agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.journal.record("team.undo")
    }

    async fn remove_agent(
        &self,
        _receipt: EntityAccessReceipt<AdminTeamRole>,
        _agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.journal.record("team.remove")
    }

    async fn quote_seat(
        &self,
        _receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<Option<SeatQuote>, TeamAgentError> {
        self.journal.record("seat.quote")?;
        Ok(self.seat.clone())
    }
}

struct FakeApiKeys {
    journal: Arc<Journal>,
}

impl AgentApiKeys for FakeApiKeys {
    async fn mint(
        &self,
        _agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<AgentApiKey, TeamAgentError> {
        self.journal.record("api_key.mint")?;
        Ok(AgentApiKey::parse(format!("mak_{}", "a".repeat(64))).expect("test API key"))
    }
}

struct FakeMailboxes {
    journal: Arc<Journal>,
    sent: Mutex<Vec<(String, SendEmail)>>,
}

impl Mailboxes for FakeMailboxes {
    async fn create(
        &self,
        _username: &str,
        _display_name: &str,
    ) -> Result<Mailbox, TeamAgentError> {
        self.journal.record("mailbox.create")?;
        Ok(Mailbox {
            mailbox_id: Some(MailboxId::parse("inbox-1".to_string()).expect("mailbox id")),
            email: "Sam@Agents.Example.com".to_string(),
        })
    }

    async fn delete(&self, _mailbox_id: &MailboxId) -> Result<(), TeamAgentError> {
        self.journal.record("mailbox.delete")
    }

    async fn list(
        &self,
        _mailbox_id: &MailboxId,
        _limit: u8,
    ) -> Result<EmailMessages, TeamAgentError> {
        Ok(EmailMessages { messages: vec![] })
    }

    async fn get(
        &self,
        _mailbox_id: &MailboxId,
        _message_id: &MailMessageId,
    ) -> Result<EmailMessage, TeamAgentError> {
        Err(TeamAgentError::EmailUnavailable)
    }

    async fn send(
        &self,
        mailbox_id: &MailboxId,
        email: &SendEmail,
    ) -> Result<SentEmail, TeamAgentError> {
        self.sent
            .lock()
            .expect("lock")
            .push((mailbox_id.to_string(), email.clone()));
        Ok(SentEmail {
            message_id: MailMessageId::parse("sent-1".to_string()).expect("message id"),
        })
    }
}

struct FakeComputers {
    journal: Arc<Journal>,
    purchases: Mutex<Vec<ComputerPurchase>>,
    interval: BillingInterval,
    status: ComputerStatus,
    unavailable: bool,
    attached: bool,
    attachment_calls: Mutex<usize>,
    catalog_calls: Mutex<usize>,
    harness_id: Mutex<Option<harness_id::HarnessId>>,
}

impl Computers for FakeComputers {
    async fn require_attached(&self) -> Result<(), TeamAgentError> {
        *self.attachment_calls.lock().unwrap() += 1;
        if !self.attached {
            return Err(hosted_runtimes::domain::models::FleetUnavailable.into());
        }
        Ok(())
    }

    fn sizes(&self) -> Vec<crate::domain::models::ComputerSizeSpec> {
        *self.catalog_calls.lock().unwrap() += 1;
        vec![crate::domain::models::ComputerSizeSpec {
            size: ComputerSize::Large,
            vcpus: 8,
            memory_gb: 16,
            disk_gb: 200,
        }]
    }

    async fn quote(
        &self,
        _team_id: Uuid,
        _size: ComputerSize,
    ) -> Result<ComputerQuote, TeamAgentError> {
        self.journal.record("computer.quote")?;
        Ok(ComputerQuote {
            vcpus: 8,
            memory_gb: 16,
            disk_gb: 200,
            price_id: StripePriceId::parse("price_computer_large").expect("price"),
            amount: 5000,
            currency: "usd".to_string(),
            interval: self.interval,
        })
    }

    async fn purchase(&self, purchase: ComputerPurchase) -> Result<ComputerId, TeamAgentError> {
        self.journal.record("computer.purchase")?;
        self.purchases.lock().expect("lock").push(purchase);
        if self.journal.fail_at == Some("computer.purchase.uncertain") {
            return Err(TeamAgentError::ComputerIdentityUnavailable);
        }
        Ok(COMPUTER_ID.parse().expect("computer id"))
    }

    async fn provision_comped(
        &self,
        purchase: ComputerPurchase,
    ) -> Result<ComputerId, TeamAgentError> {
        self.journal.record("computer.comped")?;
        assert!(purchase.extra_items.is_empty());
        self.purchases.lock().unwrap().push(purchase);
        Ok(COMPUTER_ID.parse().unwrap())
    }

    async fn status(
        &self,
        _team_id: Uuid,
        _computer_id: ComputerId,
    ) -> Result<ComputerStatus, TeamAgentError> {
        if self.unavailable {
            return Err(TeamAgentError::internal_message("status unavailable"));
        }
        Ok(self.status.clone())
    }

    async fn harness_id(
        &self,
        _team_id: Uuid,
        _computer_id: ComputerId,
    ) -> Result<Option<harness_id::HarnessId>, TeamAgentError> {
        if self.unavailable {
            return Err(TeamAgentError::NotFound);
        }
        Ok(*self.harness_id.lock().expect("harness"))
    }

    async fn persona(
        &self,
        _team_id: Uuid,
        _computer_id: ComputerId,
    ) -> Result<Persona, TeamAgentError> {
        self.journal.record("computer.persona")?;
        Ok(self
            .purchases
            .lock()
            .unwrap()
            .first()
            .unwrap()
            .persona
            .clone()
            .unwrap())
    }

    async fn retry(
        &self,
        _team_id: Uuid,
        _computer_id: ComputerId,
    ) -> Result<ComputerStatus, TeamAgentError> {
        self.journal.record("computer.retry")?;
        Ok(ComputerStatus {
            payment: self.status.payment,
            brain: None,
            status: ComputerStatusKind::SettingUp,
            setup: Some(SetupProgress {
                step: SetupStep::Creating,
                position: 1,
                total: 4,
            }),
        })
    }

    async fn release(
        &self,
        _team_id: Uuid,
        _computer_id: ComputerId,
    ) -> Result<(), TeamAgentError> {
        self.journal.record("computer.release")
    }
}

struct FakeRepos {
    journal: Arc<Journal>,
    seeds: Mutex<Vec<PersonaSeed>>,
}

impl AgentRepos for FakeRepos {
    async fn voice(
        &self,
        _agent: &MacroUserIdStr<'_>,
        _team: Uuid,
    ) -> Result<crate::domain::voice::AgentVoice, TeamAgentError> {
        self.journal.record("repo.voice")?;
        Ok(crate::domain::voice::AgentVoice {
            model: "aura-2-arcas-en".to_owned(),
        })
    }
    async fn set_voice(
        &self,
        _agent: &MacroUserIdStr<'_>,
        _team: Uuid,
        voice: crate::domain::voice::AgentVoice,
    ) -> Result<(), TeamAgentError> {
        self.journal.record("repo.set_voice")?;
        self.seeds.lock().unwrap().last_mut().unwrap().voice = Some(voice.model);
        Ok(())
    }

    async fn create(
        &self,
        _agent_user_id: &MacroUserIdStr<'_>,
        _team_id: Uuid,
        seed: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        self.journal.record("repo.create")?;
        self.seeds.lock().expect("lock").push(seed.clone());
        Ok(AgentRepo {
            url: "https://git.example.com/sam".to_string(),
            token: RepoToken::parse(format!("mrt_{}", "b".repeat(64))).expect("test repo token"),
        })
    }

    async fn ensure(
        &self,
        _agent_user_id: &MacroUserIdStr<'_>,
        _team_id: Uuid,
        seed: &PersonaSeed,
        token: &RepoToken,
    ) -> Result<(), TeamAgentError> {
        self.journal.record("repo.ensure")?;
        assert_eq!(
            token.hash(),
            RepoToken::parse(format!("mrt_{}", "b".repeat(64)))
                .expect("expected token")
                .hash()
        );
        assert_eq!(self.seeds.lock().unwrap().first(), Some(seed));
        Ok(())
    }

    async fn delete(&self, _agent_user_id: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        self.journal.record("repo.delete")
    }
}

type Service = TeamAgentServiceImpl<
    FakeRepository,
    FakeMembership,
    FakeApiKeys,
    FakeMailboxes,
    FakeComputers,
    FakeRepos,
    FakeFeatureFlags,
>;

struct Setup {
    owner_verified_email: Option<String>,
    admin_verified_email: Option<String>,
    fail_at: Option<&'static str>,
    flags: Option<FakeFeatureFlags>,
    seat: Option<SeatQuote>,
    computer_interval: BillingInterval,
    computer_status: ComputerStatus,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            owner_verified_email: None,
            admin_verified_email: None,
            fail_at: None,
            flags: Some({
                let mut flags = FakeFeatureFlags::default();
                flags.set(
                    user(ADMIN),
                    Ok(FlagSnapshot::new([(
                        TEAM_AGENTS_FLAG.to_owned(),
                        FlagValue::Boolean(true),
                    )])),
                );
                flags
            }),
            seat: Some(SeatQuote {
                amount: 4000,
                currency: "usd".to_string(),
                interval: BillingInterval::Month,
            }),
            computer_interval: BillingInterval::Month,
            computer_status: ComputerStatus {
                payment: ComputerPayment::Pending,
                brain: None,
                status: ComputerStatusKind::SettingUp,
                setup: Some(SetupProgress {
                    step: SetupStep::Creating,
                    position: 1,
                    total: 4,
                }),
            },
        }
    }
}

fn build(setup: Setup) -> (Service, Arc<Journal>) {
    let journal = Arc::new(Journal {
        steps: Mutex::new(vec![]),
        fail_at: setup.fail_at,
    });

    let service = TeamAgentServiceImpl::new(
        FakeRepository {
            owner_verified_email: setup.owner_verified_email,
            admin_verified_email: setup.admin_verified_email,
            journal: journal.clone(),
            agents: Mutex::new(vec![]),
            get_calls: Mutex::new(0),
        },
        FakeMembership {
            journal: journal.clone(),
            seat: setup.seat,
        },
        FakeApiKeys {
            journal: journal.clone(),
        },
        FakeMailboxes {
            journal: journal.clone(),
            sent: Mutex::new(vec![]),
        },
        FakeComputers {
            journal: journal.clone(),
            purchases: Mutex::new(vec![]),
            interval: setup.computer_interval,
            status: setup.computer_status,
            unavailable: false,
            attached: true,
            attachment_calls: Mutex::new(0),
            catalog_calls: Mutex::new(0),
            harness_id: Mutex::new(None),
        },
        FakeRepos {
            journal: journal.clone(),
            seeds: Mutex::new(vec![]),
        },
        setup.flags,
        "staff.example.com".to_string(),
    )
    .with_enrollment_environment(TestEnvironment);

    (service, journal)
}

fn receipt<T: entity_access::domain::models::RequiredPermission>(
    team_id: &str,
) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(ADMIN),
        team_id,
        EntityType::Team,
    )
}

fn request() -> CreateTeamAgent {
    CreateTeamAgent {
        voice: None,
        expected_included: false,
        name: "  Sam Rivera ".to_string(),
        job_description: "Runs vendor relations.".to_string(),
        personality: "Dry, direct, kind.".to_string(),
        size: ComputerSize::Large,
        avatar_url: None,
    }
}

#[tokio::test]
async fn create_invites_an_agent_and_buys_its_computer_with_its_seat() {
    let (service, journal) = build(Setup::default());

    let agent = service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create succeeds");

    assert_eq!(
        agent,
        TeamAgent {
            user_id: user(AGENT),
            team_id: Uuid::parse_str(TEAM_ID).expect("uuid"),
            name: "Sam Rivera".to_string(),
            email: "sam@agents.example.com".to_string(),
            created_by: Some(user(ADMIN)),
            computer_id: Some(COMPUTER_ID.parse().expect("computer id")),
            status: TeamAgentStatus::Provisioning,
            status_reason: None,
            setup: Some(SetupProgress {
                step: SetupStep::Creating,
                position: 1,
                total: 4
            }),
            last_turn_at: None,
            retryable: false,
            payment: Some(ComputerPayment::Pending),
            created_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
        }
    );
    assert_eq!(
        journal.steps(),
        vec![
            "mailbox.create",
            "account.create",
            "team.add",
            "repo.create",
            "computer.purchase",
            "account.set_computer",
        ]
    );
    assert_eq!(
        *service.repos.seeds.lock().expect("lock"),
        vec![PersonaSeed {
            voice: None,
            creator_id: Some(user(ADMIN)),
            name: "Sam Rivera".to_string(),
            job_description: "Runs vendor relations.".to_string(),
            personality: "Dry, direct, kind.".to_string(),
        }]
    );
    assert_eq!(
        *service.computers.purchases.lock().expect("lock"),
        vec![ComputerPurchase {
            team_id: Uuid::parse_str(TEAM_ID).expect("uuid"),
            created_by: user(ADMIN),
            size: ComputerSize::Large,
            name: Some("Sam Rivera".to_string()),
            persona: Some(Persona {
                name: "Sam Rivera".to_string(),
                os_user: PersonaOsUser::parse("agent-sam-rivera").expect("OS user"),
                extra_service: PersonaService {
                    unit_name: SystemdUnitName::parse("brain@agent-sam-rivera").expect("unit"),
                    exec: "/opt/macro/brain run".to_string(),
                    env: BTreeMap::new(),
                },
                config: BTreeMap::from([
                    (
                        PersonaConfigKey::parse("MACRO_AGENT_USER_ID").expect("config key"),
                        "macro|sam@agents.example.com".to_string(),
                    ),
                    (
                        PersonaConfigKey::parse("BRAIN_WORKSPACE").expect("config key"),
                        "/home/agent-sam-rivera/workspace".to_string()
                    ),
                    (
                        PersonaConfigKey::parse("BRAIN_HEALTH_PORT").expect("config key"),
                        "7801".to_string()
                    ),
                ]),
            }),
            extra_items: vec![SubscriptionItem {
                price_id: StripePriceId::parse("price_seat").expect("price"),
                quantity: 1,
            }],
        }]
    );
}

#[tokio::test]
async fn a_failure_before_the_purchase_undoes_everything_made_so_far() {
    let cases: [(&str, Vec<&str>); 5] = [
        ("mailbox.create", vec!["mailbox.create"]),
        (
            "account.create",
            vec!["mailbox.create", "account.create", "mailbox.delete"],
        ),
        (
            "team.add",
            vec![
                "mailbox.create",
                "account.create",
                "team.add",
                "account.delete",
                "mailbox.delete",
            ],
        ),
        (
            "repo.create",
            vec![
                "mailbox.create",
                "account.create",
                "team.add",
                "repo.create",
                "team.undo",
                "account.delete",
                "mailbox.delete",
            ],
        ),
        (
            "computer.purchase",
            vec![
                "mailbox.create",
                "account.create",
                "team.add",
                "repo.create",
                "computer.purchase",
                "repo.delete",
                "team.undo",
                "account.delete",
                "mailbox.delete",
            ],
        ),
    ];

    for (fail_at, expected) in cases {
        let (service, journal) = build(Setup {
            fail_at: Some(fail_at),
            ..Setup::default()
        });

        let result = service.create(receipt(TEAM_ID), request()).await;

        assert!(result.is_err(), "{fail_at} should fail the create");
        assert_eq!(journal.steps(), expected, "undo after {fail_at}");
        assert!(
            service.repository.agents.lock().expect("lock").is_empty(),
            "no account survives a failed {fail_at}"
        );
    }
}

#[tokio::test]
async fn a_failure_after_the_purchase_keeps_the_paid_agent() {
    let (service, journal) = build(Setup {
        fail_at: Some("account.set_computer"),
        ..Setup::default()
    });

    let result = service.create(receipt(TEAM_ID), request()).await;

    assert!(matches!(result, Err(TeamAgentError::Internal(_))));
    assert_eq!(
        journal.steps(),
        vec![
            "mailbox.create",
            "account.create",
            "team.add",
            "repo.create",
            "computer.purchase",
            "account.set_computer",
            "account.set_status",
        ]
    );
    assert_eq!(service.repository.agents.lock().expect("lock").len(), 1);
    let agent = service.agent(&user(AGENT)).await.unwrap();
    assert_eq!(agent.status, TeamAgentStatus::Provisioning);
    assert!(agent.status_reason.is_some());
    let before = journal.steps();
    assert!(matches!(
        service.delete(receipt(TEAM_ID), &agent.user_id).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert_eq!(journal.steps(), before);
}

#[tokio::test]
async fn a_team_without_seat_billing_buys_only_the_computer() {
    let (service, _journal) = build(Setup {
        seat: None,
        ..Setup::default()
    });

    service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create succeeds");

    let purchases = service.computers.purchases.lock().expect("lock");
    assert_eq!(purchases[0].extra_items, vec![]);
}

#[tokio::test]
async fn create_rejects_an_empty_personality_before_making_anything() {
    let (service, journal) = build(Setup::default());
    let mut request = request();
    request.personality = "  ".to_string();

    let result = service.create(receipt(TEAM_ID), request).await;

    assert!(matches!(result, Err(TeamAgentError::BadRequest(_))));
    assert_eq!(journal.steps(), Vec::<&str>::new());
}

#[tokio::test]
async fn create_rejects_a_name_the_computer_cannot_accept_before_making_anything() {
    let (service, journal) = build(Setup::default());
    let mut request = request();
    request.name = "a".repeat(65);

    assert!(matches!(
        service.create(receipt(TEAM_ID), request).await,
        Err(TeamAgentError::BadRequest(_))
    ));
    assert_eq!(journal.steps(), Vec::<&str>::new());
}

#[tokio::test]
async fn create_and_quote_need_the_flag_on_for_the_admin() {
    let mut off = FakeFeatureFlags::default();
    off.set(
        user(ADMIN),
        Ok(FlagSnapshot::new([(
            TEAM_AGENTS_FLAG.to_string(),
            FlagValue::Boolean(false),
        )])),
    );
    let (service, journal) = build(Setup {
        flags: Some(off),
        ..Setup::default()
    });

    assert!(matches!(
        service.create(receipt(TEAM_ID), request()).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service
            .quote(receipt(TEAM_ID), ComputerSize::Standard)
            .await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service.sizes(receipt(TEAM_ID)).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert_eq!(journal.steps(), Vec::<&str>::new());

    let mut on = FakeFeatureFlags::default();
    on.set(
        user(ADMIN),
        Ok(FlagSnapshot::new([(
            TEAM_AGENTS_FLAG.to_string(),
            FlagValue::Boolean(true),
        )])),
    );
    let (service, _journal) = build(Setup {
        flags: Some(on),
        ..Setup::default()
    });
    assert!(service.create(receipt(TEAM_ID), request()).await.is_ok());
}

#[tokio::test]
async fn create_stays_closed_when_flags_fail_to_load() {
    let mut failing = FakeFeatureFlags::default();
    failing.set(user(ADMIN), Err("posthog unavailable".to_string()));
    let (service, journal) = build(Setup {
        flags: Some(failing),
        ..Setup::default()
    });

    assert!(matches!(
        service.create(receipt(TEAM_ID), request()).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert_eq!(journal.steps(), Vec::<&str>::new());
}

#[tokio::test]
async fn quote_adds_the_seat_and_the_computer() {
    let (service, _journal) = build(Setup::default());

    let quote = service
        .quote(receipt(TEAM_ID), ComputerSize::Large)
        .await
        .expect("quoted");

    assert_eq!(
        quote,
        TeamAgentQuote {
            included: false,
            vcpus: 8,
            memory_gb: 16,
            disk_gb: 200,
            seat: 4000,
            computer: 5000,
            total: 9000,
            currency: "usd".to_string(),
            interval: BillingInterval::Month,
        }
    );

    let (service, _journal) = build(Setup {
        seat: None,
        ..Setup::default()
    });
    let quote = service
        .quote(receipt(TEAM_ID), ComputerSize::Large)
        .await
        .expect("quoted");
    assert_eq!((quote.seat, quote.total), (0, 5000));
}

#[tokio::test]
async fn quote_refuses_a_seat_and_computer_on_different_intervals() {
    let (service, _journal) = build(Setup {
        computer_interval: BillingInterval::Year,
        ..Setup::default()
    });

    assert!(matches!(
        service.quote(receipt(TEAM_ID), ComputerSize::Large).await,
        Err(TeamAgentError::Internal(_))
    ));
}

#[tokio::test]
async fn listing_shows_setup_progress_while_the_computer_comes_up() {
    let (service, _journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: None,
            status: ComputerStatusKind::SettingUp,
            setup: Some(SetupProgress {
                step: SetupStep::Booting,
                position: 2,
                total: 4,
            }),
        },
        ..Setup::default()
    });
    service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create succeeds");

    let listed = service.list(receipt(TEAM_ID)).await.expect("listed");

    assert_eq!(listed.agents[0].status, TeamAgentStatus::Provisioning);
    assert_eq!(
        listed.agents[0].setup,
        Some(SetupProgress {
            step: SetupStep::Booting,
            position: 2,
            total: 4,
        })
    );
}

#[tokio::test]
async fn a_ready_computer_makes_the_agent_running() {
    let (service, _journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: Some(healthy_brain()),
            status: ComputerStatusKind::Ready,
            setup: None,
        },
        ..Setup::default()
    });
    service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create succeeds");

    let me = service.me(&user(AGENT)).await.expect("me");

    assert_eq!(me.status, TeamAgentStatus::Running);
    assert_eq!(me.setup, None);
}

#[tokio::test]
async fn a_running_agent_reflects_a_later_computer_failure() {
    let (mut service, _journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: Some(healthy_brain()),
            status: ComputerStatusKind::Ready,
            setup: Some(SetupProgress {
                step: SetupStep::Ready,
                position: 4,
                total: 4,
            }),
        },
        ..Setup::default()
    });
    service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create");
    assert_eq!(
        service.me(&user(AGENT)).await.expect("ready").status,
        TeamAgentStatus::Running
    );
    service.computers.status = ComputerStatus {
        payment: ComputerPayment::Paid,
        brain: None,
        status: ComputerStatusKind::Failed,
        setup: None,
    };
    assert_eq!(
        service.me(&user(AGENT)).await.expect("failed").status,
        TeamAgentStatus::Failed
    );
}

#[tokio::test]
async fn listing_takes_a_failure_from_the_computer() {
    let (service, _journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: None,
            status: ComputerStatusKind::Failed,
            setup: None,
        },
        ..Setup::default()
    });
    service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create succeeds");

    let listed = service.list(receipt(TEAM_ID)).await.expect("listed");

    assert_eq!(listed.agents.len(), 1);
    assert_eq!(listed.agents[0].status, TeamAgentStatus::Failed);
    assert_eq!(
        listed.agents[0].status_reason.as_deref(),
        Some("the computer failed to start")
    );

    let stored = service.me(&user(AGENT)).await.expect("me");
    assert_eq!(stored.status, TeamAgentStatus::Failed);
    assert_eq!(
        service
            .list(receipt(OTHER_TEAM_ID))
            .await
            .expect("listed")
            .agents,
        vec![]
    );
}

#[tokio::test]
async fn delete_releases_the_computer_and_removes_the_agent_last() {
    let (service, journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: None,
            status: ComputerStatusKind::SettingUp,
            setup: Some(SetupProgress {
                step: SetupStep::Creating,
                position: 1,
                total: 4,
            }),
        },
        ..Setup::default()
    });
    service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create succeeds");
    journal.steps.lock().expect("lock").clear();

    assert!(matches!(
        service.delete(receipt(OTHER_TEAM_ID), &user(AGENT)).await,
        Err(TeamAgentError::NotFound)
    ));
    assert_eq!(journal.steps(), Vec::<&str>::new());

    service
        .delete(receipt(TEAM_ID), &user(AGENT))
        .await
        .expect("deleted");

    assert_eq!(
        journal.steps(),
        vec![
            "computer.release",
            "repo.delete",
            "team.remove",
            "mailbox.delete",
            "account.delete",
        ]
    );
    assert!(matches!(
        service.me(&user(AGENT)).await,
        Err(TeamAgentError::NotAnAgent)
    ));
}

#[tokio::test]
async fn only_agents_can_send_email() {
    let (service, _journal) = build(Setup::default());
    let email = SendEmail {
        to: vec!["vendor@example.com".to_string()],
        subject: "Hi".to_string(),
        text: "Hello".to_string(),
        html: None,
    };

    assert!(matches!(
        service.send_email(&user(ADMIN), email.clone()).await,
        Err(TeamAgentError::NotAnAgent)
    ));

    service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create succeeds");
    let sent = service.send_email(&user(AGENT), email).await.expect("sent");

    assert_eq!(sent.message_id.as_str(), "sent-1");
    assert_eq!(service.mailboxes.sent.lock().expect("lock")[0].0, "inbox-1");
}

#[test]
fn slug_is_a_valid_os_user_name() {
    assert_eq!(slug("Sam Rivera"), "sam-rivera");
    assert_eq!(slug("  Ünïcode!! Bot 2 "), "n-code-bot-2");
    assert_eq!(slug("✨"), "agent");
    assert_eq!(slug("42 Things"), "agent-42-things");
    assert_eq!(slug("root"), "agent-root");
    assert_eq!(slug("Macro"), "agent-macro");
    assert_eq!(slug("macrod"), "agent-macrod");
    assert_eq!(
        slug("Bartholomew Maximilian Montgomery"),
        "bartholomew-maximilian-m"
    );
}

#[tokio::test]
async fn retry_reuses_the_seed_computer_and_credentials_without_purchasing() {
    let (service, journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: None,
            status: ComputerStatusKind::Failed,
            // Failures must override stale setup progress.
            setup: Some(SetupProgress {
                step: SetupStep::Booting,
                position: 2,
                total: 4,
            }),
        },
        ..Setup::default()
    });
    service.create(receipt(TEAM_ID), request()).await.unwrap();
    assert!(service.me(&user(AGENT)).await.unwrap().retryable);
    // Older persisted seeds did not contain the creator. Recovery uses the
    // account's original creator without minting any new credentials.
    service.repository.agents.lock().unwrap()[0]
        .account
        .persona_seed
        .creator_id = None;
    journal.steps.lock().unwrap().clear();
    let agent = service.retry(receipt(TEAM_ID), &user(AGENT)).await.unwrap();
    assert_eq!(agent.status, TeamAgentStatus::Provisioning);
    assert_eq!(
        agent.setup.as_ref().map(|setup| setup.step),
        Some(SetupStep::Creating)
    );
    assert_eq!(agent.computer_id, Some(COMPUTER_ID.parse().unwrap()));
    assert_eq!(
        journal.steps(),
        vec!["computer.persona", "computer.retry", "account.set_status"]
    );
    assert_eq!(service.computers.purchases.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn retry_checks_team_ownership_and_leaves_a_running_agent_alone() {
    let (service, journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: Some(healthy_brain()),
            status: ComputerStatusKind::Ready,
            setup: None,
        },
        ..Setup::default()
    });
    service.create(receipt(TEAM_ID), request()).await.unwrap();
    journal.steps.lock().unwrap().clear();
    assert!(matches!(
        service.retry(receipt(OTHER_TEAM_ID), &user(AGENT)).await,
        Err(TeamAgentError::NotFound)
    ));
    assert!(journal.steps().is_empty());
    let agent = service.retry(receipt(TEAM_ID), &user(AGENT)).await.unwrap();
    assert_eq!(agent.status, TeamAgentStatus::Running);
    assert!(journal.steps().is_empty());
}

#[tokio::test]
async fn retry_rejects_a_legacy_persona_before_repository_or_computer_effects() {
    let (service, journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: None,
            status: ComputerStatusKind::Failed,
            setup: None,
        },
        ..Setup::default()
    });
    service.create(receipt(TEAM_ID), request()).await.unwrap();
    service.computers.purchases.lock().unwrap()[0]
        .persona
        .as_mut()
        .unwrap()
        .os_user = PersonaOsUser::parse("legacy-persona").expect("canonical generic Linux name");
    journal.steps.lock().unwrap().clear();
    let error = service
        .retry(receipt(TEAM_ID), &user(AGENT))
        .await
        .unwrap_err();
    assert!(matches!(error, TeamAgentError::BadRequest(ref reason) if reason.contains("agent-")));
    assert_eq!(journal.steps(), vec!["computer.persona"]);
}

#[tokio::test]
async fn failed_computer_retry_preserves_the_agent_for_another_attempt() {
    let (service, journal) = build(Setup {
        fail_at: Some("computer.retry"),
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: None,
            status: ComputerStatusKind::Failed,
            setup: None,
        },
        ..Setup::default()
    });
    service.create(receipt(TEAM_ID), request()).await.unwrap();
    journal.steps.lock().unwrap().clear();
    assert!(service.retry(receipt(TEAM_ID), &user(AGENT)).await.is_err());
    assert_eq!(
        service.agent(&user(AGENT)).await.unwrap().status,
        TeamAgentStatus::Failed
    );
    assert_eq!(journal.steps(), vec!["computer.persona", "computer.retry"]);
    journal.steps.lock().unwrap().clear();
    assert!(service.retry(receipt(TEAM_ID), &user(AGENT)).await.is_err());
    assert_eq!(journal.steps(), vec!["computer.persona", "computer.retry"]);
}

#[tokio::test]
async fn retry_does_not_purchase_a_missing_computer() {
    let (service, journal) = build(Setup::default());
    service.create(receipt(TEAM_ID), request()).await.unwrap();
    {
        let mut rows = service.repository.agents.lock().unwrap();
        rows[0].computer_id = None;
        rows[0].status = TeamAgentStatus::Failed;
    }
    journal.steps.lock().unwrap().clear();
    assert!(matches!(
        service.retry(receipt(TEAM_ID), &user(AGENT)).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert!(journal.steps().is_empty());
}

#[tokio::test]
async fn retry_rejects_released_computers_before_repo_recovery() {
    let (service, journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            brain: None,
            status: ComputerStatusKind::Released,
            setup: None,
        },
        ..Setup::default()
    });
    service.create(receipt(TEAM_ID), request()).await.unwrap();
    journal.steps.lock().unwrap().clear();
    assert!(matches!(
        service.retry(receipt(TEAM_ID), &user(AGENT)).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert!(journal.steps().is_empty());
}

#[tokio::test]
async fn missing_purchase_identity_keeps_credentials_and_a_provisioning_agent() {
    let (service, journal) = build(Setup {
        fail_at: Some("computer.purchase.uncertain"),
        ..Setup::default()
    });
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    assert_eq!(agent.status, TeamAgentStatus::Provisioning);
    assert_eq!(
        agent.status_reason.as_deref(),
        Some(COMPUTER_LINK_FAILED_REASON)
    );
    assert_eq!(agent.computer_id, None);
    assert!(!agent.retryable);
    assert!(
        !journal
            .steps()
            .iter()
            .any(|step| step.ends_with("delete") || *step == "team.undo")
    );
    let listed = service.list(receipt(TEAM_ID)).await.unwrap();
    assert_eq!(listed.agents[0], agent);
    assert!(matches!(
        service.retry(receipt(TEAM_ID), &agent.user_id).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert!(matches!(
        service.delete(receipt(TEAM_ID), &agent.user_id).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert_eq!(service.computers.purchases.lock().unwrap().len(), 1);
    assert_eq!(service.repository.agents.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn pending_payment_clears_legacy_failure_and_waits_without_another_purchase() {
    let (service, journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Pending,
            brain: None,
            status: ComputerStatusKind::SettingUp,
            setup: Some(SetupProgress {
                step: SetupStep::Creating,
                position: 1,
                total: 4,
            }),
        },
        ..Setup::default()
    });
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    service
        .repository
        .set_status(
            &agent.user_id,
            TeamAgentStatus::Failed,
            Some("old purchase reconciliation reason"),
        )
        .await
        .unwrap();
    let listed = service.list(receipt(TEAM_ID)).await.unwrap();
    let pending = &listed.agents[0];
    assert_eq!(pending.status, TeamAgentStatus::Provisioning);
    assert_eq!(pending.status_reason, None);
    assert_eq!(pending.setup.as_ref().unwrap().step, SetupStep::Creating);
    assert!(!pending.retryable);
    let before = journal.steps();
    assert!(matches!(
        service.retry(receipt(TEAM_ID), &agent.user_id).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert_eq!(journal.steps(), before);
    assert_eq!(service.computers.purchases.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn payment_failed_retains_agent_rejects_retry_and_allows_release() {
    let (service, journal) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Unbilled,
            brain: None,
            status: ComputerStatusKind::Failed,
            setup: None,
        },
        ..Setup::default()
    });
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    assert_eq!(agent.status, TeamAgentStatus::Failed);
    assert_eq!(agent.status_reason.as_deref(), Some("payment failed"));
    assert!(!agent.retryable);
    assert!(agent.computer_id.is_some());
    let before = journal.steps();
    assert!(matches!(
        service.retry(receipt(TEAM_ID), &agent.user_id).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert!(
        journal.steps()[before.len()..]
            .iter()
            .all(|step| *step == "account.set_status")
    );
    assert_eq!(service.computers.purchases.lock().unwrap().len(), 1);
    service
        .delete(receipt(TEAM_ID), &agent.user_id)
        .await
        .unwrap();
    assert!(journal.steps().contains(&"computer.release"));
    assert!(journal.steps().contains(&"team.undo"));
    assert!(!journal.steps().contains(&"team.remove"));
    assert!(service.repository.agents.lock().unwrap().is_empty());
}

#[tokio::test]
async fn pending_payment_cannot_be_deleted_while_the_outbox_can_still_charge() {
    let (service, journal) = build(Setup::default());
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    let before = journal.steps();
    assert!(matches!(
        service.delete(receipt(TEAM_ID), &agent.user_id).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert_eq!(journal.steps(), before);
    assert_eq!(service.repository.agents.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn partial_payment_failed_deletion_never_removes_a_billed_seat() {
    let (mut service, journal) = build(Setup {
        fail_at: Some("repo.delete"),
        computer_status: ComputerStatus {
            payment: ComputerPayment::Unbilled,
            brain: None,
            status: ComputerStatusKind::Failed,
            setup: None,
        },
        ..Setup::default()
    });
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    assert!(
        service
            .delete(receipt(TEAM_ID), &agent.user_id)
            .await
            .is_err()
    );
    assert_eq!(
        service.me(&agent.user_id).await.unwrap().payment,
        Some(ComputerPayment::Unbilled)
    );
    service.computers.status.status = ComputerStatusKind::Released;
    // A list refresh may replace the display reason; billing provenance stays.
    service.list(receipt(TEAM_ID)).await.unwrap();
    service.repos.journal = Arc::new(Journal::default());
    service
        .delete(receipt(TEAM_ID), &agent.user_id)
        .await
        .unwrap();
    assert!(journal.steps().contains(&"team.undo"));
    assert!(!journal.steps().contains(&"team.remove"));
}

#[tokio::test]
async fn external_release_preserves_payment_authority_for_membership_cleanup() {
    for (payment, reason, expected, forbidden) in [
        (
            ComputerPayment::Paid,
            "the computer was released",
            "team.remove",
            "team.undo",
        ),
        (
            ComputerPayment::Unbilled,
            "payment failed",
            "team.undo",
            "team.remove",
        ),
    ] {
        let (service, journal) = build(Setup {
            computer_status: ComputerStatus {
                payment,
                status: ComputerStatusKind::Released,
                brain: None,
                setup: None,
            },
            ..Setup::default()
        });
        let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
        assert_eq!(agent.payment, Some(payment));
        assert_eq!(agent.status_reason.as_deref(), Some(reason));
        assert!(!agent.retryable);
        service
            .delete(receipt(TEAM_ID), &agent.user_id)
            .await
            .unwrap();
        assert!(journal.steps().contains(&expected));
        assert!(!journal.steps().contains(&forbidden));
    }
}

fn healthy_brain() -> super::super::models::BrainHealth {
    super::super::models::BrainHealth {
        connected: true,
        checked_at: Utc::now(),
        healthy: true,
        last_error: None,
        last_turn_at: Some(Utc.timestamp_opt(1_700_000_000, 0).unwrap()),
    }
}

#[tokio::test]
async fn running_requires_a_ready_computer_and_live_healthy_persona() {
    let healthy = healthy_brain();
    let mut unhealthy = healthy.clone();
    unhealthy.healthy = false;
    unhealthy.last_error = Some("brain process exited".to_string());
    let mut disconnected = healthy.clone();
    disconnected.connected = false;
    let mut stale = healthy.clone();
    stale.checked_at = Utc::now() - chrono::Duration::minutes(3);
    for (status, brain, expected, reason) in [
        (
            ComputerStatusKind::Ready,
            Some(healthy.clone()),
            TeamAgentStatus::Running,
            None,
        ),
        (
            ComputerStatusKind::Ready,
            Some(unhealthy),
            TeamAgentStatus::Unhealthy,
            Some("unhealthy: brain process exited"),
        ),
        (
            ComputerStatusKind::Ready,
            None,
            TeamAgentStatus::Unhealthy,
            Some("unhealthy: brain health has not been reported"),
        ),
        (
            ComputerStatusKind::Ready,
            Some(disconnected),
            TeamAgentStatus::Unhealthy,
            Some("unhealthy: the harness is disconnected"),
        ),
        (
            ComputerStatusKind::Ready,
            Some(stale),
            TeamAgentStatus::Unhealthy,
            Some("unhealthy: the brain health report is stale"),
        ),
        (
            ComputerStatusKind::Asleep,
            Some(healthy.clone()),
            TeamAgentStatus::Provisioning,
            None,
        ),
        (
            ComputerStatusKind::Stopped,
            Some(healthy.clone()),
            TeamAgentStatus::Provisioning,
            None,
        ),
    ] {
        let expected_turn = brain.as_ref().and_then(|brain| brain.last_turn_at);
        let (service, _) = build(Setup {
            computer_status: ComputerStatus {
                payment: ComputerPayment::Paid,
                status,
                brain,
                setup: None,
            },
            ..Setup::default()
        });
        service.create(receipt(TEAM_ID), request()).await.unwrap();
        let me = service.me(&user(AGENT)).await.unwrap();
        assert_eq!(me.status, expected);
        assert_eq!(me.status_reason.as_deref(), reason);
        assert_eq!(me.last_turn_at, expected_turn);
        assert!(!me.retryable);
        let listed = service.list(receipt(TEAM_ID)).await.unwrap();
        assert_eq!(listed.agents[0], me);
    }
}

#[tokio::test]
async fn health_failure_diagnostics_are_updated_and_recovery_clears_them() {
    let (mut service, _) = build(Setup {
        computer_status: ComputerStatus {
            payment: ComputerPayment::Paid,
            status: ComputerStatusKind::Ready,
            setup: None,
            brain: None,
        },
        ..Setup::default()
    });
    service.create(receipt(TEAM_ID), request()).await.unwrap();
    assert_eq!(
        service.me(&user(AGENT)).await.unwrap().status,
        TeamAgentStatus::Unhealthy
    );
    let mut brain = healthy_brain();
    brain.healthy = false;
    brain.last_error = Some("workspace clone failed".to_string());
    service.computers.status.brain = Some(brain);
    let failed = service.me(&user(AGENT)).await.unwrap();
    assert_eq!(
        failed.status_reason.as_deref(),
        Some("unhealthy: workspace clone failed")
    );
    assert_eq!(
        service
            .repository
            .get(&user(AGENT))
            .await
            .unwrap()
            .unwrap()
            .status_reason,
        None
    );
    service.computers.status.brain = Some(healthy_brain());
    let recovered = service.me(&user(AGENT)).await.unwrap();
    assert_eq!(recovered.status, TeamAgentStatus::Running);
    assert_eq!(recovered.status_reason, None);
    assert!(recovered.last_turn_at.is_some());
}

#[tokio::test]
async fn verified_owner_domain_includes_both_seat_and_computer_without_billing() {
    let (service, journal) = build(Setup {
        owner_verified_email: Some("owner@STAFF.EXAMPLE.COM".to_string()),
        computer_status: ComputerStatus {
            payment: ComputerPayment::Comped,
            brain: None,
            status: ComputerStatusKind::SettingUp,
            setup: None,
        },
        ..Setup::default()
    });
    let quote = service
        .quote(receipt(TEAM_ID), ComputerSize::Large)
        .await
        .unwrap();
    assert!(quote.included);
    assert_eq!((quote.seat, quote.computer, quote.total), (0, 0, 0));
    assert_eq!((quote.vcpus, quote.memory_gb, quote.disk_gb), (8, 16, 200));
    let mut request = request();
    request.expected_included = true;
    let agent = service.create(receipt(TEAM_ID), request).await.unwrap();
    assert_eq!(agent.payment, Some(ComputerPayment::Comped));
    assert!(journal.steps().contains(&"computer.comped"));
    assert!(!journal.steps().contains(&"computer.purchase"));
    assert!(!journal.steps().contains(&"seat.quote"));
    assert!(!journal.steps().contains(&"computer.quote"));
    service
        .delete(receipt(TEAM_ID), &agent.user_id)
        .await
        .unwrap();
    assert!(journal.steps().contains(&"team.undo"));
    assert!(!journal.steps().contains(&"team.remove"));
}

#[tokio::test]
async fn actor_or_similar_domains_do_not_comp_a_teams_agents() {
    for email in [
        None,
        Some("owner@not-staff.example.com"),
        Some("owner@staff.example.com.evil.test"),
        Some("owner@sub.staff.example.com"),
    ] {
        let (service, _) = build(Setup {
            owner_verified_email: email.map(str::to_string),
            ..Setup::default()
        });
        assert!(
            !service
                .quote(receipt(TEAM_ID), ComputerSize::Large)
                .await
                .unwrap()
                .included
        );
    }
}

#[tokio::test]
async fn a_reviewed_free_invitation_cannot_turn_into_a_paid_purchase() {
    for (owner, expected_included) in [
        (None, true),
        (Some("owner@staff.example.com".to_string()), false),
    ] {
        let (service, journal) = build(Setup {
            owner_verified_email: owner,
            ..Setup::default()
        });
        let mut request = request();
        request.expected_included = expected_included;
        assert!(matches!(
            service.create(receipt(TEAM_ID), request).await,
            Err(TeamAgentError::QuoteChanged)
        ));
        assert!(journal.steps().is_empty());
    }
}

#[tokio::test]
async fn a_failed_comped_agent_retries_without_a_billed_purchase() {
    let (service, journal) = build(Setup {
        owner_verified_email: Some("owner@staff.example.com".to_string()),
        computer_status: ComputerStatus {
            payment: ComputerPayment::Comped,
            brain: None,
            status: ComputerStatusKind::Failed,
            setup: None,
        },
        ..Setup::default()
    });
    let mut request = request();
    request.expected_included = true;
    let agent = service.create(receipt(TEAM_ID), request).await.unwrap();
    assert!(agent.retryable);
    let retried = service
        .retry(receipt(TEAM_ID), &agent.user_id)
        .await
        .unwrap();
    assert_eq!(retried.computer_id, agent.computer_id);
    assert_eq!(retried.payment, Some(ComputerPayment::Comped));
    assert!(journal.steps().contains(&"computer.retry"));
    assert!(!journal.steps().contains(&"computer.purchase"));
}

#[tokio::test]
async fn a_verified_team_admin_qualifies_without_a_verified_owner() {
    let (service, journal) = build(Setup {
        admin_verified_email: Some("admin@staff.example.com".to_owned()),
        ..Setup::default()
    });
    assert!(
        service
            .quote(receipt(TEAM_ID), ComputerSize::Large)
            .await
            .unwrap()
            .included
    );
    let mut create = request();
    create.expected_included = true;
    service.create(receipt(TEAM_ID), create).await.unwrap();
    assert!(journal.steps().contains(&"computer.comped"));
    assert!(!journal.steps().contains(&"computer.purchase"));
}

#[tokio::test]
async fn connecting_disconnect_then_ready_health_loss_and_reconnect_never_latch_failure() {
    let (mut service, _) = build(Setup::default());
    service.create(receipt(TEAM_ID), request()).await.unwrap();
    // Repair legacy rows that incorrectly latched a transient disconnect.
    service
        .repository
        .set_status(
            &user(AGENT),
            TeamAgentStatus::Failed,
            Some("unhealthy: the harness is disconnected"),
        )
        .await
        .unwrap();
    let mut disconnected = healthy_brain();
    disconnected.connected = false;
    service.computers.status = ComputerStatus {
        payment: ComputerPayment::Paid,
        // Even a ready phase cannot override first-connect setup progress.
        status: ComputerStatusKind::Ready,
        setup: Some(SetupProgress {
            step: SetupStep::Connecting,
            position: 3,
            total: 4,
        }),
        brain: Some(disconnected.clone()),
    };
    let connecting = service.me(&user(AGENT)).await.unwrap();
    assert_eq!(connecting.status, TeamAgentStatus::Provisioning);
    assert_eq!(connecting.setup.unwrap().step, SetupStep::Connecting);
    assert_eq!(connecting.status_reason, None);
    service.computers.status.setup = None;
    service.computers.status.brain = Some(healthy_brain());
    assert_eq!(
        service.me(&user(AGENT)).await.unwrap().status,
        TeamAgentStatus::Running
    );
    service.computers.status.brain = Some(disconnected);
    let unhealthy = service.me(&user(AGENT)).await.unwrap();
    assert_eq!(unhealthy.status, TeamAgentStatus::Unhealthy);
    assert!(!unhealthy.retryable);
    let stored = service.repository.get(&user(AGENT)).await.unwrap().unwrap();
    assert_eq!(stored.status, TeamAgentStatus::Running);
    assert_eq!(stored.status_reason, None);
    service.computers.unavailable = true;
    assert_eq!(
        service.list(receipt(TEAM_ID)).await.unwrap().agents[0].status,
        TeamAgentStatus::Unhealthy
    );
    assert_eq!(
        service
            .repository
            .get(&user(AGENT))
            .await
            .unwrap()
            .unwrap()
            .status,
        TeamAgentStatus::Running
    );
    service.computers.unavailable = false;
    service.computers.status.brain = Some(healthy_brain());
    let recovered = service.me(&user(AGENT)).await.unwrap();
    assert_eq!(recovered.status, TeamAgentStatus::Running);
    assert_eq!(recovered.status_reason, None);
}

#[tokio::test]
async fn purchase_status_outage_stays_provisioning_and_recovers() {
    let (mut service, _) = build(Setup::default());
    service.computers.unavailable = true;
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    assert_eq!(agent.status, TeamAgentStatus::Provisioning);
    assert_eq!(agent.status_reason, None);
    service.computers.unavailable = false;
    service.computers.status.status = ComputerStatusKind::Ready;
    service.computers.status.payment = ComputerPayment::Paid;
    service.computers.status.setup = None;
    service.computers.status.brain = Some(healthy_brain());
    assert_eq!(
        service.me(&user(AGENT)).await.unwrap().status,
        TeamAgentStatus::Running
    );
}

#[tokio::test]
async fn voice_management_requires_admin_receipts_and_the_same_team() {
    use entity_access::domain::models::{Entity, EntityPermission, TeamRole};
    let (service, _) = build(Setup::default());
    service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create");
    // Being the recorded creator does not let a demoted member mint an admin capability.
    assert!(
        EntityAccessReceipt::<AdminTeamRole>::try_new_authenticated_user(
            user(ADMIN),
            Entity {
                entity_id: TEAM_ID.to_owned(),
                entity_type: EntityType::Team
            },
            EntityPermission::TeamRole {
                role: TeamRole::Member
            },
        )
        .is_err()
    );
    let voice = super::super::voice::AgentVoice {
        model: "aura-2-thalia-en".to_owned(),
    };
    assert!(matches!(
        service.voice(receipt(OTHER_TEAM_ID), &user(AGENT)).await,
        Err(TeamAgentError::NotFound)
    ));
    assert!(matches!(
        service
            .set_voice(receipt(OTHER_TEAM_ID), &user(AGENT), voice.clone())
            .await,
        Err(TeamAgentError::NotFound)
    ));
    assert_eq!(
        service.list(receipt(TEAM_ID)).await.unwrap().agents.len(),
        1
    );
    assert_eq!(
        service
            .set_voice(receipt(TEAM_ID), &user(AGENT), voice.clone())
            .await
            .unwrap(),
        voice
    );
    assert!(service.voice(receipt(TEAM_ID), &user(AGENT)).await.is_ok());
}

mod rollout;

mod discovery;

#[tokio::test]
async fn a_real_invite_persona_passes_hosted_runtime_validation_without_bootstrap_secrets() {
    use hosted_runtimes::domain::{
        enrollment::{DeviceSecret, Enrollment},
        models::ComputerName,
        persona_credentials::EnrollmentGeneration,
        ports::PersonaCredentialSource,
    };
    let (service, _) = build(Setup::default());
    let agent = service
        .create(
            receipt(TEAM_ID),
            CreateTeamAgent {
                voice: None,
                expected_included: false,
                name: "Agent Example".to_owned(),
                job_description: "Maintain the workspace.".to_owned(),
                personality: "Direct.".to_owned(),
                size: ComputerSize::Large,
                avatar_url: None,
            },
        )
        .await
        .unwrap();
    let persona = service.computers.purchases.lock().unwrap()[0]
        .persona
        .clone()
        .unwrap();
    let stored = serde_json::to_value(&persona).unwrap();
    serde_json::from_value::<Persona>(stored.clone())
        .expect("the real invite persona must pass hosted-runtimes validation");
    let material = service
        .issue(agent.computer_id.unwrap(), EnrollmentGeneration::new(1))
        .await
        .unwrap();
    let enrollment = Enrollment {
        generation: EnrollmentGeneration::new(1),
        computer_id: agent.computer_id.unwrap(),
        pairing_id: "00000000-0000-0000-0000-00000000000a".parse().unwrap(),
        device_secret: DeviceSecret::new("mhds_fixture".to_owned()),
        name: ComputerName::try_new("Agent Example").unwrap(),
        service_url_overrides: Default::default(),
        persona: Some(persona),
        traceparent: None,
        persona_enrollment: material,
    };
    let delivered = serde_json::to_value(enrollment).unwrap();
    for (key, expected) in [
        ("MACRO_API_KEY", format!("mak_{}", "a".repeat(64))),
        ("ANTHROPIC_AUTH_TOKEN", format!("mak_{}", "a".repeat(64))),
        ("MACRO_REPO_TOKEN", format!("mrt_{}", "b".repeat(64))),
    ] {
        assert!(stored["config"].get(key).is_none());
        assert_eq!(delivered["persona_enrollment"]["secrets"][key], expected);
    }
}

impl crate::domain::enrollment::EnrollmentAccounts for FakeRepository {
    type Guard = ();
    async fn enrollment_context(
        &self,
        computer: ComputerId,
        _candidate: Option<&MacroUserIdStr<'_>>,
        _team: Uuid,
    ) -> Result<
        crate::domain::enrollment::EnrollmentContext<()>,
        hosted_runtimes::domain::persona_credentials::PersonaCredentialError,
    > {
        use crate::domain::enrollment::{EnrollmentAgent, EnrollmentContext};
        use hosted_runtimes::domain::persona_credentials::PersonaCredentialError;
        let agents = self.agents.lock().unwrap();
        let agent = agents
            .iter()
            .find(|a| a.computer_id == Some(computer))
            .ok_or(PersonaCredentialError::NotFound)?;
        Ok(EnrollmentContext {
            guard: (),
            agent: Some(EnrollmentAgent {
                user_id: agent.account.user_id.clone(),
                team_id: agent.account.team_id,
                is_agent: true,
                seed: agent.account.persona_seed.clone(),
            }),
        })
    }
    async fn finish_enrollment(
        &self,
        _guard: (),
        _computer: ComputerId,
        _agent: &MacroUserIdStr<'_>,
    ) -> Result<(), hosted_runtimes::domain::persona_credentials::PersonaCredentialError> {
        Ok(())
    }
}

#[tokio::test]
async fn each_unclaimed_issuance_rotates_both_credentials_and_stale_generations_do_nothing() {
    use hosted_runtimes::domain::{
        persona_credentials::{EnrollmentGeneration, PersonaCredentialError},
        ports::PersonaCredentialSource,
    };
    let (service, journal) = build(Setup::default());
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    journal.steps.lock().unwrap().clear();
    let computer = agent.computer_id.unwrap();
    service
        .issue(computer, EnrollmentGeneration::new(1))
        .await
        .unwrap();
    service
        .issue(computer, EnrollmentGeneration::new(1))
        .await
        .unwrap();
    assert_eq!(
        journal.steps(),
        vec!["api_key.mint", "repo.create", "api_key.mint", "repo.create"]
    );
    assert!(matches!(
        service.issue(computer, EnrollmentGeneration::new(2)).await,
        Err(PersonaCredentialError::NotFound)
    ));
    assert_eq!(
        journal.steps(),
        vec!["api_key.mint", "repo.create", "api_key.mint", "repo.create"]
    );
}

impl crate::domain::enrollment::EnrollmentComputers for FakeComputers {
    async fn enrollment_computer(
        &self,
        computer: ComputerId,
    ) -> Result<
        hosted_runtimes::domain::models::Computer,
        hosted_runtimes::domain::persona_credentials::PersonaCredentialError,
    > {
        use hosted_runtimes::domain::{
            lifecycle::{ComputerState, HostId},
            models::{Computer, ComputerName},
            persona_credentials::{EnrollmentGeneration, PersonaCredentialError},
            size::current_catalog,
        };
        let purchases = self.purchases.lock().unwrap();
        let purchase = purchases.last().ok_or(PersonaCredentialError::NotFound)?;
        let catalog = current_catalog();
        let entry = catalog.iter().find(|e| e.size == purchase.size).unwrap();
        let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        Ok(Computer {
            id: computer,
            team_id: purchase.team_id,
            name: ComputerName::try_new("Agent").unwrap(),
            size: purchase.size,
            resources: entry.resources,
            catalog_entry: entry.id.clone(),
            price_id: None,
            state: ComputerState::reserved(HostId::new(Uuid::from_u128(1)), now),
            harness_id: None,
            persona: purchase.persona.clone(),
            enrollment_generation: EnrollmentGeneration::new(1),
            created_by: purchase.created_by.clone(),
            created_at: now,
            enrolled_at: None,
        })
    }
}

struct TestEnvironment;
impl crate::domain::enrollment::EnrollmentEnvironment for TestEnvironment {
    fn environment(
        &self,
    ) -> Result<
        hosted_runtimes::domain::persona_credentials::PersonaEnv,
        hosted_runtimes::domain::persona_credentials::PersonaCredentialError,
    > {
        hosted_runtimes::domain::persona_credentials::PersonaEnv::new(
            [
                (
                    "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
                    "https://storage.example.com",
                ),
                ("OVERRIDE_AUTH_SERVICE_URL", "https://auth.example.com"),
                (
                    "OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL",
                    "https://cognition.example.com",
                ),
                (
                    "OVERRIDE_AGENT_HARNESS_SERVICE_URL",
                    "https://harness.example.com",
                ),
                (
                    "OVERRIDE_SCHEDULED_ACTION_SERVICE_URL",
                    "https://scheduled.example.com",
                ),
                (
                    "OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL",
                    "wss://connection.example.com/ws",
                ),
                ("OVERRIDE_MCP_SERVICE_URL", "https://mcp.example.com/base"),
                ("MACRO_GATEWAY", "https://gateway.example.com"),
                (
                    "ANTHROPIC_BASE_URL",
                    "https://egress.example.com/brain/anthropic",
                ),
            ]
            .into_iter()
            .map(|(key, value)| (PersonaConfigKey::parse(key).unwrap(), value.to_owned()))
            .collect(),
        )
    }
}

#[tokio::test]
async fn missing_enrollment_environment_does_not_rotate_credentials() {
    use hosted_runtimes::domain::{
        persona_credentials::{EnrollmentGeneration, PersonaCredentialError},
        ports::PersonaCredentialSource,
    };
    let (mut service, journal) = build(Setup::default());
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    service.enrollment_environment = None;
    journal.steps.lock().unwrap().clear();
    assert!(matches!(
        service
            .issue(agent.computer_id.unwrap(), EnrollmentGeneration::new(1))
            .await,
        Err(PersonaCredentialError::Unavailable)
    ));
    assert!(journal.steps().is_empty());
}

mod health;

struct InvalidGitEnvironment;
impl crate::domain::enrollment::EnrollmentEnvironment for InvalidGitEnvironment {
    fn environment(
        &self,
    ) -> Result<
        hosted_runtimes::domain::persona_credentials::PersonaEnv,
        hosted_runtimes::domain::persona_credentials::PersonaCredentialError,
    > {
        Err(hosted_runtimes::domain::persona_credentials::PersonaCredentialError::Unavailable)
    }
}

#[tokio::test]
async fn invalid_git_environment_preflight_touches_neither_credential_issuer() {
    use hosted_runtimes::domain::{
        persona_credentials::{EnrollmentGeneration, PersonaCredentialError},
        ports::PersonaCredentialSource,
    };
    let (service, journal) = build(Setup::default());
    let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
    let service = service.with_enrollment_environment(InvalidGitEnvironment);
    journal.steps.lock().unwrap().clear();
    assert!(matches!(
        service
            .issue(agent.computer_id.unwrap(), EnrollmentGeneration::new(1))
            .await,
        Err(PersonaCredentialError::Unavailable)
    ));
    assert!(
        journal.steps().is_empty(),
        "invalid preflight must not mint a key or create/reissue a repo"
    );
}

#[tokio::test]
async fn detached_fleet_is_transient_and_agent_removal_still_uses_saved_payment() {
    for payment in [ComputerPayment::Paid, ComputerPayment::Comped] {
        let (mut service, journal) = build(Setup {
            computer_status: ComputerStatus {
                payment,
                status: ComputerStatusKind::Ready,
                setup: None,
                brain: Some(healthy_brain()),
            },
            ..Setup::default()
        });
        let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
        assert_eq!(agent.status, TeamAgentStatus::Running);
        service.computers.status.status = ComputerStatusKind::Unavailable;
        service.computers.status.brain = None;
        let unavailable = service.me(&agent.user_id).await.unwrap();
        assert_eq!(unavailable.status, TeamAgentStatus::Unhealthy);
        assert_eq!(
            unavailable.status_reason.as_deref(),
            Some("computers are not available")
        );
        assert_eq!(unavailable.payment, Some(payment));
        assert!(!unavailable.retryable);
        let saved = service
            .repository
            .get(&agent.user_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.status, TeamAgentStatus::Running);
        assert_eq!(saved.status_reason, None);
        service.computers.status.status = ComputerStatusKind::Ready;
        service.computers.status.brain = Some(healthy_brain());
        let recovered = service.me(&agent.user_id).await.unwrap();
        assert_eq!(recovered.status, TeamAgentStatus::Running);
        assert_eq!(recovered.status_reason, None);

        service.computers.status.status = ComputerStatusKind::Unavailable;
        service
            .delete(receipt(TEAM_ID), &agent.user_id)
            .await
            .unwrap();
        let steps = journal.steps();
        assert!(steps.contains(&"computer.release"));
        assert!(steps.contains(&"repo.delete"));
        assert!(steps.contains(&if payment == ComputerPayment::Comped {
            "team.undo"
        } else {
            "team.remove"
        }));
    }
}

#[tokio::test]
async fn detached_management_quote_precedes_catalog_and_prices_for_paid_and_included_teams() {
    for included in [false, true] {
        let (mut service, journal) = build(Setup {
            admin_verified_email: included.then(|| "admin@staff.example.com".to_owned()),
            ..Setup::default()
        });
        service.computers.attached = false;
        assert!(matches!(
            service
                .quote(receipt(TEAM_ID), ComputerSize::Standard)
                .await,
            Err(TeamAgentError::FleetUnavailable(_))
        ));
        assert_eq!(*service.computers.attachment_calls.lock().unwrap(), 1);
        assert_eq!(*service.computers.catalog_calls.lock().unwrap(), 0);
        assert_eq!(*service.repository.get_calls.lock().unwrap(), 0);
        assert!(journal.steps().is_empty());

        service.rollout = TeamAgentRollout::new(None);
        assert!(matches!(
            service
                .quote(receipt(TEAM_ID), ComputerSize::Standard)
                .await,
            Err(TeamAgentError::NotEnabled)
        ));
        assert_eq!(*service.computers.attachment_calls.lock().unwrap(), 1);
    }
}

#[tokio::test]
async fn detached_management_create_precedes_account_and_repo_setup_for_paid_and_included_teams() {
    for included in [false, true] {
        let (mut service, journal) = build(Setup {
            admin_verified_email: included.then(|| "admin@staff.example.com".to_owned()),
            ..Setup::default()
        });
        service.computers.attached = false;
        let mut input = request();
        input.expected_included = included;
        assert!(matches!(
            service.create(receipt(TEAM_ID), input.clone()).await,
            Err(TeamAgentError::FleetUnavailable(_))
        ));
        assert_eq!(*service.computers.attachment_calls.lock().unwrap(), 1);
        assert_eq!(*service.computers.catalog_calls.lock().unwrap(), 0);
        assert!(service.repository.agents.lock().unwrap().is_empty());
        assert!(service.computers.purchases.lock().unwrap().is_empty());
        assert!(journal.steps().is_empty());

        service.rollout = TeamAgentRollout::new(None);
        assert!(matches!(
            service.create(receipt(TEAM_ID), input).await,
            Err(TeamAgentError::NotEnabled)
        ));
        assert_eq!(*service.computers.attachment_calls.lock().unwrap(), 1);
    }
}

#[tokio::test]
async fn detached_management_retry_precedes_roster_projection_for_paid_and_included_agents() {
    for payment in [ComputerPayment::Paid, ComputerPayment::Comped] {
        let (mut service, journal) = build(Setup {
            computer_status: ComputerStatus {
                payment,
                status: ComputerStatusKind::Ready,
                brain: Some(healthy_brain()),
                setup: None,
            },
            ..Setup::default()
        });
        let agent = service.create(receipt(TEAM_ID), request()).await.unwrap();
        service.computers.attached = false;
        service.computers.status.status = ComputerStatusKind::Unavailable;
        service.computers.status.brain = None;
        let reads = *service.repository.get_calls.lock().unwrap();
        let steps = journal.steps();
        let attachment_calls = *service.computers.attachment_calls.lock().unwrap();
        assert!(matches!(
            service.retry(receipt(TEAM_ID), &agent.user_id).await,
            Err(TeamAgentError::FleetUnavailable(_))
        ));
        assert_eq!(
            *service.computers.attachment_calls.lock().unwrap(),
            attachment_calls + 1
        );
        assert_eq!(*service.repository.get_calls.lock().unwrap(), reads);
        assert_eq!(journal.steps(), steps);

        service.rollout = TeamAgentRollout::new(None);
        assert!(matches!(
            service.retry(receipt(TEAM_ID), &agent.user_id).await,
            Err(TeamAgentError::NotEnabled)
        ));
        assert_eq!(
            *service.computers.attachment_calls.lock().unwrap(),
            attachment_calls + 1
        );
    }
}
