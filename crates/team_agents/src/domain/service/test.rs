use std::sync::Mutex;

use chrono::Utc;
use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt, EntityType};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::models::{EmailMessage, Mailbox};

const TEAM_ID: &str = "0190f1b4-6c2e-7b7a-9a4c-1d2e3f405060";

#[derive(Debug, thiserror::Error)]
#[error("fake repo error")]
struct FakeRepoError;

#[derive(Default)]
struct FakeRepo {
    accounts: Mutex<Vec<NewAgentAccount>>,
    brains: Mutex<Vec<(String, Uuid, Uuid)>>,
    deleted: Mutex<Vec<String>>,
}

impl TeamAgentRepository for FakeRepo {
    type Err = FakeRepoError;

    async fn create_account(&self, account: &NewAgentAccount) -> Result<(), FakeRepoError> {
        self.accounts
            .lock()
            .map_err(|_| FakeRepoError)?
            .push(account.clone());
        Ok(())
    }

    async fn delete_account(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), FakeRepoError> {
        self.deleted
            .lock()
            .map_err(|_| FakeRepoError)?
            .push(user_id.as_ref().to_string());
        Ok(())
    }

    async fn set_brain(
        &self,
        user_id: &MacroUserIdStr<'_>,
        bot_id: Uuid,
        session_id: Uuid,
    ) -> Result<(), FakeRepoError> {
        self.brains.lock().map_err(|_| FakeRepoError)?.push((
            user_id.as_ref().to_string(),
            bot_id,
            session_id,
        ));
        Ok(())
    }

    async fn get(&self, user_id: &MacroUserIdStr<'_>) -> Result<Option<TeamAgent>, FakeRepoError> {
        let accounts = self.accounts.lock().map_err(|_| FakeRepoError)?;
        let brains = self.brains.lock().map_err(|_| FakeRepoError)?;

        Ok(accounts
            .iter()
            .find(|account| account.user_id.as_ref() == user_id.as_ref())
            .map(|account| {
                let brain = brains.iter().find(|(id, _, _)| id == user_id.as_ref());

                TeamAgent {
                    user_id: account.user_id.clone(),
                    team_id: account.team_id,
                    name: account.name.clone(),
                    job_description: account.job_description.clone(),
                    personality: account.personality.clone(),
                    email: account.email.clone(),
                    created_by: Some(account.created_by.clone()),
                    harness_id: Some(account.harness_id),
                    brain_bot_id: brain.map(|(_, bot_id, _)| *bot_id),
                    brain_session_id: brain.map(|(_, _, session_id)| *session_id),
                    created_at: Utc::now(),
                }
            }))
    }

    async fn mailbox_id(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<String>, FakeRepoError> {
        let accounts = self.accounts.lock().map_err(|_| FakeRepoError)?;

        Ok(accounts
            .iter()
            .find(|account| account.user_id.as_ref() == user_id.as_ref())
            .and_then(|account| account.mailbox_id.clone()))
    }
}

struct FakeTeams;

impl TeamMembership for FakeTeams {
    async fn add_agent(
        &self,
        _receipt: EntityAccessReceipt<AdminTeamRole>,
        _agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        Ok(())
    }
}

struct FakeKeys;

impl AgentApiKeys for FakeKeys {
    async fn mint(&self, _agent_user_id: &MacroUserIdStr<'_>) -> Result<String, TeamAgentError> {
        Ok("mak_secret".to_string())
    }
}

#[derive(Default)]
struct FakeMailboxes {
    deleted: Mutex<Vec<String>>,
    sent: Mutex<Vec<(String, SendEmail)>>,
}

impl Mailboxes for FakeMailboxes {
    async fn create(&self, username: &str, _display_name: &str) -> Result<Mailbox, TeamAgentError> {
        Ok(Mailbox {
            mailbox_id: Some(format!("inbox-{username}")),
            email: format!("{username}@Example.com"),
        })
    }

    async fn delete(&self, mailbox_id: &str) -> Result<(), TeamAgentError> {
        self.deleted
            .lock()
            .map_err(|_| TeamAgentError::Forbidden)?
            .push(mailbox_id.to_string());
        Ok(())
    }

    async fn list(&self, _mailbox_id: &str, _limit: u8) -> Result<EmailMessages, TeamAgentError> {
        Ok(EmailMessages { messages: vec![] })
    }

    async fn get(
        &self,
        _mailbox_id: &str,
        _message_id: &str,
    ) -> Result<EmailMessage, TeamAgentError> {
        Err(TeamAgentError::EmailUnavailable)
    }

    async fn send(&self, mailbox_id: &str, email: &SendEmail) -> Result<SentEmail, TeamAgentError> {
        self.sent
            .lock()
            .map_err(|_| TeamAgentError::Forbidden)?
            .push((mailbox_id.to_string(), email.clone()));
        Ok(SentEmail {
            message_id: "sent-1".to_string(),
        })
    }
}

struct FakeLauncher {
    bind_fails: bool,
    launches: Mutex<Vec<BrainLaunch>>,
}

impl BrainLauncher for FakeLauncher {
    async fn bind(
        &self,
        _api_key: &str,
        _name: &str,
        _harness_id: Uuid,
        _team_id: Uuid,
        _model: &str,
    ) -> Result<Uuid, TeamAgentError> {
        if self.bind_fails {
            return Err(TeamAgentError::Runtime(
                "the runtime is offline".to_string(),
            ));
        }

        Ok(Uuid::nil())
    }

    fn start(&self, launch: BrainLaunch) {
        if let Ok(mut launches) = self.launches.lock() {
            launches.push(launch);
        }
    }
}

type Service = TeamAgentServiceImpl<FakeRepo, FakeTeams, FakeKeys, FakeMailboxes, FakeLauncher>;

fn service(bind_fails: bool) -> Service {
    TeamAgentServiceImpl::new(
        FakeRepo::default(),
        FakeTeams,
        FakeKeys,
        FakeMailboxes::default(),
        FakeLauncher {
            bind_fails,
            launches: Mutex::new(vec![]),
        },
        BrainEnvironment {
            environment: "dev".to_string(),
            gateway_url: "https://dev-gateway.macro.com".to_string(),
        },
    )
}

fn receipt() -> EntityAccessReceipt<AdminTeamRole> {
    let admin = MacroUserIdStr::parse_from_str("macro|admin@example.com")
        .map(MacroUserIdStr::into_owned)
        .unwrap_or_else(|_| panic!("valid user id"));

    EntityAccessReceipt::dangerously_assert_authenticated_user(admin, TEAM_ID, EntityType::Team)
}

fn request(name: &str) -> CreateTeamAgent {
    CreateTeamAgent {
        name: name.to_string(),
        job_description: "Runs vendor relations.".to_string(),
        personality: "Dry, direct, kind.".to_string(),
        avatar_url: None,
        harness_id: Uuid::nil(),
        model: "default".to_string(),
    }
}

#[tokio::test]
async fn create_makes_an_account_and_starts_the_brain() {
    let service = service(false);

    let agent = service
        .create(receipt(), request("Sam Rivera"))
        .await
        .unwrap_or_else(|error| panic!("create failed: {error}"));

    assert!(agent.email.starts_with("sam-rivera-"));
    assert!(agent.email.ends_with("@example.com"));
    assert_eq!(agent.user_id.as_ref(), format!("macro|{}", agent.email));
    assert_eq!(agent.team_id.to_string(), TEAM_ID);
    assert_eq!(agent.brain_bot_id, Some(Uuid::nil()));

    let launches = service
        .launcher
        .launches
        .lock()
        .unwrap_or_else(|_| panic!("lock"));
    assert_eq!(launches.len(), 1);
    assert_eq!(Some(launches[0].session_id), agent.brain_session_id);
    assert!(launches[0].prompt.contains("mak_secret"));
    assert!(launches[0].prompt.contains("~/team-agents/sam-rivera/"));
    assert!(launches[0].prompt.contains("macro|admin@example.com"));
    assert!(!launches[0].prompt.contains("{{"));
}

#[tokio::test]
async fn create_rolls_back_when_the_runtime_refuses() {
    let service = service(true);

    let result = service.create(receipt(), request("Bob")).await;

    assert!(matches!(result, Err(TeamAgentError::Runtime(_))));
    assert_eq!(service.repo.deleted.lock().map(|d| d.len()).unwrap_or(0), 1);
    assert_eq!(
        service
            .mailboxes
            .deleted
            .lock()
            .map(|d| d.len())
            .unwrap_or(0),
        1
    );
}

#[tokio::test]
async fn create_rejects_an_empty_personality() {
    let service = service(false);
    let mut request = request("Bob");
    request.personality = "  ".to_string();

    let result = service.create(receipt(), request).await;

    assert!(matches!(result, Err(TeamAgentError::BadRequest(_))));
    assert!(
        service
            .repo
            .accounts
            .lock()
            .map(|a| a.is_empty())
            .unwrap_or(false)
    );
}

#[tokio::test]
async fn only_agents_can_send_email() {
    let service = service(false);
    let human = MacroUserIdStr::parse_from_str("macro|human@example.com")
        .unwrap_or_else(|_| panic!("valid user id"));
    let email = SendEmail {
        to: vec!["vendor@example.com".to_string()],
        subject: "Hi".to_string(),
        text: "Hello".to_string(),
        html: None,
    };

    let result = service.send_email(&human, email.clone()).await;
    assert!(matches!(result, Err(TeamAgentError::NotAnAgent)));

    let agent = service
        .create(receipt(), request("Bob"))
        .await
        .unwrap_or_else(|error| panic!("create failed: {error}"));
    let sent = service
        .send_email(&agent.user_id, email)
        .await
        .unwrap_or_else(|error| panic!("send failed: {error}"));

    assert_eq!(sent.message_id, "sent-1");
    let sent_from = service
        .mailboxes
        .sent
        .lock()
        .map(|s| s[0].0.clone())
        .unwrap_or_default();
    assert!(sent_from.starts_with("inbox-bob-"));
}

#[test]
fn slug_keeps_ascii_words() {
    assert_eq!(slug("Sam Rivera"), "sam-rivera");
    assert_eq!(slug("  Ünïcode!! Bot 2 "), "n-code-bot-2");
    assert_eq!(slug("✨"), "agent");
}
