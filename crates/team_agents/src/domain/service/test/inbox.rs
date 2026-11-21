//! The agent teammates service driving agents' inboxes.

use std::collections::HashMap;

use super::*;
use crate::domain::inbox::{AgentInboxFailure, AgentInboxState, InboxError};

const ADDRESS: &str = "sam-rivera@agents.example.com";

/// The inbox lifecycle, journaling into the service's journal.
#[derive(Clone)]
struct FakeInboxes {
    journal: Journal,
    /// Answer every call with this instead.
    failing: Option<fn() -> InboxError>,
    made: Arc<Mutex<HashMap<String, AgentInbox>>>,
}

impl FakeInboxes {
    fn new(journal: Journal) -> Self {
        Self {
            journal,
            failing: None,
            made: Arc::default(),
        }
    }
}

impl AgentInboxes for FakeInboxes {
    async fn provision(
        &self,
        _team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
        name: &str,
        local_part: &str,
    ) -> Result<AgentInbox, InboxError> {
        self.journal
            .record(format!("inbox.provision {name} {local_part}"));
        if let Some(error) = self.failing {
            return Err(error());
        }
        let inbox = AgentInbox {
            address: Some(ADDRESS.to_owned()),
            state: AgentInboxState::Active,
            failure: None,
            fake_provider: true,
        };
        self.made
            .lock()
            .unwrap()
            .insert(agent.as_ref().to_owned(), inbox.clone());
        Ok(inbox)
    }

    async fn refresh(&self, agent: &MacroUserIdStr<'_>) -> Result<AgentInbox, InboxError> {
        self.journal.record("inbox.refresh");
        self.made
            .lock()
            .unwrap()
            .get(agent.as_ref())
            .cloned()
            .ok_or(InboxError::NoInbox)
    }

    async fn for_team(&self, _team_id: Uuid) -> Result<HashMap<String, AgentInbox>, InboxError> {
        Ok(self.made.lock().unwrap().clone())
    }

    async fn pause(&self, _team_id: Uuid, _agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        self.journal.record("inbox.pause");
        match self.failing {
            Some(error) => Err(error()),
            None => Ok(()),
        }
    }

    async fn release(&self, _team_id: Uuid, _agent: &MacroUserIdStr<'_>) -> Result<(), InboxError> {
        self.journal.record("inbox.release");
        match self.failing {
            Some(error) => Err(error()),
            None => Ok(()),
        }
    }
}

type InboxService = TeamAgentServiceImpl<
    FakeRepository,
    FakeMembership,
    FakeApiKeys,
    FakeRepos,
    FakeComputers,
    FakeRepository,
    Flags,
    FakeNotices,
    FakeInboxes,
>;

fn with_inboxes(flag: bool, failing: Option<fn() -> InboxError>) -> (InboxService, Journal, Flags) {
    let (service, journal, flags) = service_with_flags(flag, FakeComputers::default());
    let inboxes = FakeInboxes {
        failing,
        ..FakeInboxes::new(journal.clone())
    };
    (service.with_inboxes(inboxes), journal, flags)
}

fn unavailable() -> InboxError {
    InboxError::Unavailable(Report::new(FakeError).into_dynamic())
}

fn with_inbox() -> CreateTeamAgent {
    CreateTeamAgent {
        inbox: true,
        ..request()
    }
}

#[tokio::test]
async fn an_invite_with_an_inbox_makes_it_after_the_computer_is_bought() {
    let (service, journal, _) = with_inboxes(true, None);

    let agent = service.create(receipt(), with_inbox()).await.unwrap();

    assert_eq!(agent.inbox.unwrap().address.as_deref(), Some(ADDRESS));
    assert_eq!(
        journal.entries()[3..],
        [
            "computer.purchase Sam Rivera by macro|admin@example.com".to_owned(),
            "inbox.provision Sam Rivera sam-rivera".to_owned(),
        ]
    );
    let listed = service.list(receipt()).await.unwrap();
    assert_eq!(
        listed.agents[0].inbox.as_ref().map(|inbox| inbox.state),
        Some(AgentInboxState::Active)
    );
}

#[tokio::test]
async fn an_invite_without_an_inbox_makes_none() {
    let (service, journal, _) = with_inboxes(true, None);

    let agent = service.create(receipt(), request()).await.unwrap();

    assert_eq!(agent.inbox, None);
    assert!(!journal.entries().iter().any(|e| e.starts_with("inbox.")));
}

#[tokio::test]
async fn an_inbox_that_cant_be_made_never_fails_the_invite() {
    let (service, journal, _) = with_inboxes(true, Some(unavailable));

    let agent = service
        .create(receipt(), with_inbox())
        .await
        .expect("the agent and its computer exist");

    assert_eq!(agent.inbox, None);
    assert!(agent.computer_id.is_some());
    // Nothing was taken back.
    assert!(
        !journal
            .entries()
            .iter()
            .any(|e| e == "account.delete" || e == "repo.delete")
    );
}

#[tokio::test]
async fn an_admin_adds_an_inbox_later_and_again_changes_nothing_new() {
    let (service, journal, _) = with_inboxes(true, None);
    let agent = service.create(receipt(), request()).await.unwrap();

    let added = service.add_inbox(receipt(), &agent.user_id).await.unwrap();
    let read = service.inbox(receipt(), &agent.user_id).await.unwrap();

    assert_eq!(added, read);
    assert_eq!(added.state, AgentInboxState::Active);
    let provisions = journal
        .entries()
        .into_iter()
        .filter(|entry| entry.starts_with("inbox.provision"))
        .collect::<Vec<_>>();
    assert_eq!(provisions, vec!["inbox.provision Sam Rivera sam-rivera"]);
}

#[tokio::test]
async fn without_the_inbox_rollout_nothing_is_made() {
    let (service, journal, flags) = with_inboxes(true, None);
    let agent = service.create(receipt(), request()).await.unwrap();
    flags.set(false);

    assert!(matches!(
        service.add_inbox(receipt(), &agent.user_id).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(!journal.entries().iter().any(|e| e.starts_with("inbox.")));
}

#[tokio::test]
async fn another_teams_agent_gets_no_inbox() {
    let (service, journal, _) = with_inboxes(true, None);
    let agent = service.create(receipt(), request()).await.unwrap();
    let other_team = EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(ADMIN),
        "0193a1b2-0000-7000-8000-0000000000bb",
        EntityType::Team,
    );

    assert!(matches!(
        service.add_inbox(other_team, &agent.user_id).await,
        Err(TeamAgentError::NotFound)
    ));
    assert!(!journal.entries().iter().any(|e| e.starts_with("inbox.")));
}

#[tokio::test]
async fn without_a_provider_adding_an_inbox_says_so() {
    let (service, _, _) = with_inboxes(true, Some(|| InboxError::NotConfigured));
    let agent = service.create(receipt(), request()).await.unwrap();

    assert!(matches!(
        service.add_inbox(receipt(), &agent.user_id).await,
        Err(TeamAgentError::InboxesNotConfigured)
    ));
}

#[tokio::test]
async fn removing_an_agent_pauses_its_inbox_after_its_keys_and_before_its_seat() {
    let (service, journal, _) = with_inboxes(true, None);
    let agent = service.create(receipt(), with_inbox()).await.unwrap();

    service.delete(receipt(), &agent.user_id).await.unwrap();

    assert_eq!(
        journal.entries()[5..],
        [
            "computer.release".to_owned(),
            "api_key.revoke_all".to_owned(),
            "inbox.pause".to_owned(),
            "repo.create Sam Rivera".to_owned(),
            "team.remove".to_owned(),
            "seat.remove".to_owned(),
        ]
    );
}

#[tokio::test]
async fn a_pause_email_service_misses_leaves_the_agent_seated_to_retry() {
    let (service, journal, _) = with_inboxes(true, Some(unavailable));
    let agent = service.create(receipt(), request()).await.unwrap();

    let removed = service.delete(receipt(), &agent.user_id).await;

    assert!(matches!(removed, Err(TeamAgentError::InboxUnavailable(_))));
    assert!(!journal.entries().contains(&"seat.remove".to_owned()));
    assert_eq!(service.list(receipt()).await.unwrap().agents.len(), 1);
}

#[tokio::test]
async fn a_taken_back_invite_releases_its_inbox() {
    let (service, journal, _) = with_inboxes(true, None);
    let agent = service.create(receipt(), with_inbox()).await.unwrap();

    service
        .undo_invite(TEAM.parse().unwrap(), &agent.user_id)
        .await
        .unwrap();

    assert_eq!(
        journal.entries()[5..7],
        ["api_key.revoke_all".to_owned(), "inbox.release".to_owned()]
    );
}

#[tokio::test]
async fn a_failed_inbox_shows_on_the_list_with_its_reason() {
    let (service, _, _) = with_inboxes(true, None);
    let agent = service.create(receipt(), request()).await.unwrap();
    service.inboxes.made.lock().unwrap().insert(
        agent.user_id.as_ref().to_owned(),
        AgentInbox {
            address: None,
            state: AgentInboxState::Failed,
            failure: Some(AgentInboxFailure::AddressTaken),
            fake_provider: false,
        },
    );

    let listed = service.list(receipt()).await.unwrap();

    assert_eq!(
        listed.agents[0]
            .inbox
            .as_ref()
            .and_then(|inbox| inbox.failure),
        Some(AgentInboxFailure::AddressTaken)
    );
}

#[tokio::test]
async fn with_only_the_inbox_rollout_off_the_list_shows_no_inboxes_and_asks_nothing() {
    let (service, journal, flags) = with_inboxes(true, None);
    let agent = service.create(receipt(), with_inbox()).await.unwrap();
    service.inboxes.made.lock().unwrap().insert(
        agent.user_id.as_ref().to_owned(),
        AgentInbox {
            address: None,
            state: AgentInboxState::Provisioning,
            failure: None,
            fake_provider: false,
        },
    );
    flags.set_inboxes(false);

    let listed = service.list(receipt()).await.unwrap();

    assert_eq!(listed.agents.len(), 1);
    assert_eq!(listed.agents[0].inbox, None);
    assert!(!journal.entries().contains(&"inbox.refresh".to_owned()));
}

#[tokio::test]
async fn a_member_sees_no_inbox_addresses_and_asks_nothing() {
    let (service, journal, _) = with_inboxes(true, None);
    service.create(receipt(), with_inbox()).await.unwrap();

    let listed = service.list(team_receipt(TeamRole::Member)).await.unwrap();

    assert_eq!(listed.agents.len(), 1);
    assert_eq!(listed.agents[0].inbox, None);
    assert!(!journal.entries().contains(&"inbox.refresh".to_owned()));
}

#[tokio::test]
async fn a_repeated_invite_still_makes_the_inbox_the_first_never_made() {
    let (service, journal, _) = with_inboxes(true, None);
    // The first request bought the computer and then died before the inbox.
    service.create(receipt(), request()).await.unwrap();

    let repeated = service.create(receipt(), with_inbox()).await.unwrap();

    assert_eq!(
        repeated.inbox.map(|inbox| inbox.state),
        Some(AgentInboxState::Active)
    );
    assert!(
        journal
            .entries()
            .contains(&"inbox.provision Sam Rivera sam-rivera".to_owned())
    );
}
