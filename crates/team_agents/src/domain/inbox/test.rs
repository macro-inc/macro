use std::sync::{Arc, Mutex};

use super::*;

const TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);
const MAILBOX: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00b1);
const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const ADDRESS: &str = "sam-rivera@agents.example.com";

fn agent() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned()
}

#[derive(Debug, thiserror::Error)]
#[error("fake storage failure")]
struct FakeError;

/// `team_agent_inboxes` in memory.
#[derive(Clone, Default)]
struct FakeRecords(Arc<Mutex<Vec<InboxRecord>>>);

impl FakeRecords {
    fn only(&self) -> InboxRecord {
        let records = self.0.lock().unwrap();
        assert_eq!(records.len(), 1);
        records[0].clone()
    }
}

impl AgentInboxRepository for FakeRecords {
    type Err = FakeError;

    async fn reserve(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
        request_id: Uuid,
    ) -> Result<InboxRecord, FakeError> {
        let mut records = self.0.lock().unwrap();
        if let Some(record) = records.iter().find(|r| r.agent.as_ref() == agent.as_ref()) {
            return Ok(record.clone());
        }
        let record = InboxRecord {
            agent: agent.clone().into_owned(),
            team_id,
            request_id,
            mailbox_id: None,
            address: None,
            state: AgentInboxState::Provisioning,
            last_error: None,
            fake_provider: false,
            updated_at: DateTime::UNIX_EPOCH,
        };
        records.push(record.clone());
        Ok(record)
    }

    async fn get(&self, agent: &MacroUserIdStr<'_>) -> Result<Option<InboxRecord>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.agent.as_ref() == agent.as_ref())
            .cloned())
    }

    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<InboxRecord>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.team_id == team_id)
            .cloned()
            .collect())
    }

    async fn update(
        &self,
        agent: &MacroUserIdStr<'_>,
        update: &InboxUpdate,
    ) -> Result<InboxRecord, FakeError> {
        let mut records = self.0.lock().unwrap();
        let record = records
            .iter_mut()
            .find(|r| r.agent.as_ref() == agent.as_ref())
            .ok_or(FakeError)?;
        record.mailbox_id = update.mailbox_id.or(record.mailbox_id);
        record.address = update.address.clone().or(record.address.take());
        record.state = update.state;
        record.last_error = update.last_error;
        record.fake_provider = update.fake_provider;
        Ok(record.clone())
    }
}

/// What the fake email_service answers next.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Answer {
    Active,
    Slow,
    Taken,
    NotConfigured,
    Down,
}

/// email_service's agent mailboxes, journaling each call.
#[derive(Clone)]
struct FakeMailboxes {
    answer: Arc<Mutex<Answer>>,
    calls: Arc<Mutex<Vec<String>>>,
    /// The mailbox email_service holds, once made.
    made: Arc<Mutex<Option<MailboxView>>>,
}

impl FakeMailboxes {
    fn answering(answer: Answer) -> Self {
        Self {
            answer: Arc::new(Mutex::new(answer)),
            calls: Arc::default(),
            made: Arc::default(),
        }
    }

    fn answer(&self, answer: Answer) {
        *self.answer.lock().unwrap() = answer;
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn view(state: AgentInboxState) -> MailboxView {
        MailboxView {
            mailbox_id: MAILBOX,
            address: Some(ADDRESS.to_owned()),
            state,
            last_error: None,
            fake_provider: false,
        }
    }
}

fn down() -> MailboxError {
    MailboxError::Unavailable(rootcause::Report::new(FakeError).into_dynamic())
}

impl AgentMailboxes for FakeMailboxes {
    async fn provision(&self, request: &ProvisionMailbox) -> Result<MailboxView, MailboxError> {
        self.calls.lock().unwrap().push(format!(
            "provision {} {} {}",
            request.request_id, request.display_name, request.local_part
        ));
        let view = match *self.answer.lock().unwrap() {
            Answer::Active => Self::view(AgentInboxState::Active),
            Answer::Slow => MailboxView {
                address: None,
                ..Self::view(AgentInboxState::Provisioning)
            },
            Answer::Taken => MailboxView {
                address: None,
                last_error: Some(AgentInboxFailure::AddressTaken),
                ..Self::view(AgentInboxState::Failed)
            },
            Answer::NotConfigured => return Err(MailboxError::NotConfigured),
            Answer::Down => return Err(down()),
        };
        *self.made.lock().unwrap() = Some(view.clone());
        Ok(view)
    }

    async fn status(
        &self,
        _agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<MailboxView>, MailboxError> {
        self.calls.lock().unwrap().push("status".to_owned());
        match *self.answer.lock().unwrap() {
            Answer::Down => Err(down()),
            Answer::NotConfigured => Err(MailboxError::NotConfigured),
            _ => Ok(self.made.lock().unwrap().clone()),
        }
    }

    async fn pause(&self, _agent: &MacroUserIdStr<'_>) -> Result<(), MailboxError> {
        self.calls.lock().unwrap().push("pause".to_owned());
        match *self.answer.lock().unwrap() {
            Answer::Down => Err(down()),
            _ => Ok(()),
        }
    }

    async fn release(&self, _agent: &MacroUserIdStr<'_>) -> Result<(), MailboxError> {
        self.calls.lock().unwrap().push("release".to_owned());
        match *self.answer.lock().unwrap() {
            Answer::Down => Err(down()),
            _ => Ok(()),
        }
    }
}

fn service(
    answer: Answer,
) -> (
    InboxService<FakeRecords, FakeMailboxes>,
    FakeRecords,
    FakeMailboxes,
) {
    let records = FakeRecords::default();
    let mailboxes = FakeMailboxes::answering(answer);
    (
        InboxService::new(records.clone(), mailboxes.clone()),
        records,
        mailboxes,
    )
}

#[tokio::test]
async fn provisioning_names_the_mailbox_after_the_agent_and_stores_its_address() {
    let (service, records, mailboxes) = service(Answer::Active);

    let inbox = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    assert_eq!(
        inbox,
        AgentInbox {
            address: Some(ADDRESS.to_owned()),
            state: AgentInboxState::Active,
            failure: None,
            fake_provider: false,
        }
    );
    let record = records.only();
    assert_eq!(record.mailbox_id, Some(MAILBOX));
    // The agent's identity is untouched: the address lives only on the inbox.
    assert_eq!(record.agent.as_ref(), AGENT);
    assert_eq!(
        mailboxes.calls(),
        vec![format!(
            "provision {} Sam Rivera sam-rivera",
            record.request_id
        )]
    );
}

#[tokio::test]
async fn every_retry_reuses_the_first_request_id_so_one_agent_gets_one_mailbox() {
    let (service, records, mailboxes) = service(Answer::Down);

    let first = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    assert_eq!(first.state, AgentInboxState::Failed);
    assert_eq!(first.failure, Some(AgentInboxFailure::Unavailable));
    mailboxes.answer(Answer::Active);
    let second = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    let third = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    assert_eq!(second.state, AgentInboxState::Active);
    assert_eq!(third, second);
    let request_id = records.only().request_id;
    // The active inbox isn't asked for again.
    assert_eq!(
        mailboxes.calls(),
        vec![
            format!("provision {request_id} Sam Rivera sam-rivera"),
            format!("provision {request_id} Sam Rivera sam-rivera"),
        ]
    );
}

#[tokio::test]
async fn a_taken_address_is_a_failed_inbox_with_its_reason() {
    let (service, _, _) = service(Answer::Taken);

    let inbox = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    assert_eq!(inbox.state, AgentInboxState::Failed);
    assert_eq!(inbox.failure, Some(AgentInboxFailure::AddressTaken));
}

#[tokio::test]
async fn without_a_provider_the_request_is_refused_and_remembered() {
    let (service, records, _) = service(Answer::NotConfigured);

    let refused = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await;

    assert!(matches!(refused, Err(InboxError::NotConfigured)));
    assert_eq!(
        records.only().last_error,
        Some(AgentInboxFailure::NotConfigured)
    );
}

#[tokio::test]
async fn a_slow_provider_leaves_it_provisioning_until_a_refresh_sees_it_active() {
    let (service, _, mailboxes) = service(Answer::Slow);

    let inbox = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    assert_eq!(inbox.state, AgentInboxState::Provisioning);
    assert_eq!(inbox.address, None);
    // email_service finished in the background.
    *mailboxes.made.lock().unwrap() = Some(FakeMailboxes::view(AgentInboxState::Active));

    let refreshed = service.refresh(&agent()).await.unwrap();

    assert_eq!(refreshed.state, AgentInboxState::Active);
    assert_eq!(refreshed.address.as_deref(), Some(ADDRESS));
}

#[tokio::test]
async fn a_refresh_while_email_service_is_down_keeps_what_was_known() {
    let (service, _, mailboxes) = service(Answer::Slow);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    mailboxes.answer(Answer::Down);

    let refreshed = service.refresh(&agent()).await.unwrap();

    assert_eq!(refreshed.state, AgentInboxState::Provisioning);
}

#[tokio::test]
async fn an_agent_without_an_inbox_has_none_to_refresh_pause_or_release() {
    let (service, _, mailboxes) = service(Answer::Active);

    assert!(matches!(
        service.refresh(&agent()).await,
        Err(InboxError::NoInbox)
    ));
    service.pause(&agent()).await.unwrap();
    service.release(&agent()).await.unwrap();

    assert!(mailboxes.calls().is_empty());
}

#[tokio::test]
async fn pausing_stops_the_mailbox_once_and_keeps_it() {
    let (service, records, mailboxes) = service(Answer::Active);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    service.pause(&agent()).await.unwrap();
    service.pause(&agent()).await.unwrap();

    assert_eq!(records.only().state, AgentInboxState::Paused);
    let pauses = mailboxes
        .calls()
        .into_iter()
        .filter(|call| call.starts_with("pause"))
        .collect::<Vec<_>>();
    assert_eq!(pauses, vec!["pause".to_owned()]);
}

#[tokio::test]
async fn a_pause_email_service_misses_fails_so_the_removal_is_retried() {
    let (service, records, mailboxes) = service(Answer::Active);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    mailboxes.answer(Answer::Down);

    let missed = service.pause(&agent()).await;

    assert!(matches!(missed, Err(InboxError::Unavailable(_))));
    assert_eq!(records.only().state, AgentInboxState::Active);
}

#[tokio::test]
async fn releasing_a_mailbox_still_being_made_finds_it_through_email_service() {
    let (service, records, mailboxes) = service(Answer::Slow);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    // The answer carried the id; forget it, as if the answer had been lost.
    records.0.lock().unwrap()[0].mailbox_id = None;

    service.release(&agent()).await.unwrap();

    assert_eq!(records.only().state, AgentInboxState::Released);
    assert!(mailboxes.calls().contains(&"release".to_owned()));
}

#[tokio::test]
async fn releasing_an_inbox_email_service_never_made_releases_nothing() {
    let (service, records, mailboxes) = service(Answer::Down);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    mailboxes.answer(Answer::Active);

    service.release(&agent()).await.unwrap();

    assert_eq!(records.only().state, AgentInboxState::Released);
    assert!(
        !mailboxes
            .calls()
            .iter()
            .any(|call| call.starts_with("release"))
    );
}
