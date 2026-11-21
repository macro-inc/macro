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
        state: AgentInboxState,
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
            state,
            last_error: None,
            fake_provider: false,
            updated_at: Utc::now(),
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
        record.updated_at = Utc::now();
        Ok(record.clone())
    }

    async fn unsettled(
        &self,
        changed_before: DateTime<Utc>,
        after: Option<&SweepCursor>,
        limit: u32,
    ) -> Result<Vec<InboxRecord>, FakeError> {
        let mut found: Vec<InboxRecord> = self
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|r| {
                matches!(
                    r.state,
                    AgentInboxState::Pausing | AgentInboxState::Releasing
                ) && r.updated_at < changed_before
                    && after.is_none_or(|after| {
                        (r.updated_at, r.agent.as_ref().to_owned())
                            > (after.updated_at, after.agent.clone())
                    })
            })
            .cloned()
            .collect();
        found.sort_by_key(|r| (r.updated_at, r.agent.as_ref().to_owned()));
        found.truncate(limit as usize);
        Ok(found)
    }

    async fn update_live(
        &self,
        agent: &MacroUserIdStr<'_>,
        update: &InboxUpdate,
    ) -> Result<Option<InboxRecord>, FakeError> {
        let wound_down = self
            .0
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.agent.as_ref() == agent.as_ref())
            .is_none_or(|r| {
                matches!(
                    r.state,
                    AgentInboxState::Pausing
                        | AgentInboxState::Paused
                        | AgentInboxState::Releasing
                        | AgentInboxState::Released
                )
            });
        if wound_down {
            return Ok(None);
        }
        self.update(agent, update).await.map(Some)
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

/// What a test runs while a provision is in flight.
type DuringProvision = Box<dyn Fn() + Send>;

/// email_service's agent mailboxes, journaling each call.
#[derive(Clone)]
struct FakeMailboxes {
    answer: Arc<Mutex<Answer>>,
    calls: Arc<Mutex<Vec<String>>>,
    /// The mailbox email_service holds, once made.
    made: Arc<Mutex<Option<MailboxView>>>,
    /// Pauses fail while set, whatever the answer.
    fail_pause: Arc<Mutex<bool>>,
    /// What a release answers.
    release_outcome: Arc<Mutex<ReleaseOutcome>>,
    /// Runs while a provision is in flight, as a concurrent request would.
    during_provision: Arc<Mutex<Option<DuringProvision>>>,
}

impl FakeMailboxes {
    fn answering(answer: Answer) -> Self {
        Self {
            answer: Arc::new(Mutex::new(answer)),
            calls: Arc::default(),
            made: Arc::default(),
            fail_pause: Arc::default(),
            release_outcome: Arc::new(Mutex::new(ReleaseOutcome::Released)),
            during_provision: Arc::default(),
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
        if let Some(during) = self.during_provision.lock().unwrap().as_ref() {
            during();
        }
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
        if *self.fail_pause.lock().unwrap() {
            return Err(down());
        }
        match *self.answer.lock().unwrap() {
            Answer::Down => Err(down()),
            _ => Ok(()),
        }
    }

    async fn release(&self, _agent: &MacroUserIdStr<'_>) -> Result<ReleaseOutcome, MailboxError> {
        self.calls.lock().unwrap().push("release".to_owned());
        match *self.answer.lock().unwrap() {
            Answer::Down => Err(down()),
            _ => Ok(*self.release_outcome.lock().unwrap()),
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
async fn an_agent_without_an_inbox_has_none_to_refresh() {
    let (service, _, mailboxes) = service(Answer::Active);

    assert!(matches!(
        service.refresh(&agent()).await,
        Err(InboxError::NoInbox)
    ));
    assert!(mailboxes.calls().is_empty());
}

#[tokio::test]
async fn pausing_stops_the_mailbox_once_and_keeps_it() {
    let (service, records, mailboxes) = service(Answer::Active);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    service.pause(TEAM, &agent()).await.unwrap();
    service.pause(TEAM, &agent()).await.unwrap();

    assert_eq!(records.only().state, AgentInboxState::Paused);
    let pauses = mailboxes
        .calls()
        .into_iter()
        .filter(|call| call.starts_with("pause"))
        .collect::<Vec<_>>();
    // Confirmed paused: a repeat has nothing left to do.
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

    let missed = service.pause(TEAM, &agent()).await;
    // Marked pausing, so no provision revives it; the retry tells
    // email_service again.
    assert!(matches!(missed, Err(InboxError::Unavailable(_))));
    assert_eq!(records.only().state, AgentInboxState::Pausing);
    mailboxes.answer(Answer::Active);
    service.pause(TEAM, &agent()).await.unwrap();

    let pauses = mailboxes
        .calls()
        .into_iter()
        .filter(|call| call == "pause")
        .count();
    assert_eq!(pauses, 2);
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

    service.release(TEAM, &agent()).await.unwrap();

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

    service.release(TEAM, &agent()).await.unwrap();
    // A provision could still make one: the mark waits, then settles.
    assert_eq!(records.only().state, AgentInboxState::Releasing);
    service
        .sweep_once(
            Utc::now() + SETTLE_WITHOUT_MAILBOX + chrono::Duration::minutes(1),
            None,
            SWEEP_BATCH,
        )
        .await
        .unwrap();

    assert_eq!(records.only().state, AgentInboxState::Released);
    assert!(
        !mailboxes
            .calls()
            .iter()
            .any(|call| call.starts_with("release"))
    );
}

#[tokio::test]
async fn a_lost_answer_heals_once_email_service_has_made_the_mailbox() {
    let (service, _, mailboxes) = service(Answer::Down);
    let lost = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    assert_eq!(lost.failure, Some(AgentInboxFailure::Unavailable));
    // email_service got the request after all and finished it.
    mailboxes.answer(Answer::Active);
    *mailboxes.made.lock().unwrap() = Some(FakeMailboxes::view(AgentInboxState::Active));

    let refreshed = service.refresh(&agent()).await.unwrap();

    assert_eq!(refreshed.state, AgentInboxState::Active);
    assert_eq!(refreshed.address.as_deref(), Some(ADDRESS));
}

#[tokio::test]
async fn pausing_an_inbox_email_service_never_made_only_marks_it_until_it_settles() {
    let (service, records, mailboxes) = service(Answer::Down);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    mailboxes.answer(Answer::Active);

    service.pause(TEAM, &agent()).await.unwrap();
    assert_eq!(records.only().state, AgentInboxState::Pausing);

    // Long after the mark, still nothing at email_service: it settles.
    service
        .sweep_once(
            Utc::now() + SETTLE_WITHOUT_MAILBOX + chrono::Duration::minutes(1),
            None,
            SWEEP_BATCH,
        )
        .await
        .unwrap();

    assert_eq!(records.only().state, AgentInboxState::Paused);
    assert!(!mailboxes.calls().iter().any(|call| call == "pause"));
}

#[tokio::test]
async fn an_agent_removed_before_any_inbox_gets_none_later() {
    let (service, records, mailboxes) = service(Answer::Active);

    service.pause(TEAM, &agent()).await.unwrap();
    let late = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    assert_eq!(late.state, AgentInboxState::Paused);
    assert_eq!(records.only().state, AgentInboxState::Paused);
    assert!(
        !mailboxes
            .calls()
            .iter()
            .any(|call| call.starts_with("provision"))
    );
}

#[tokio::test]
async fn an_agent_removed_while_its_inbox_is_being_made_ends_up_paused() {
    let (service, records, mailboxes) = service(Answer::Active);
    // The removal marks the record while email_service is creating the
    // mailbox, so its own pause finds nothing to pause yet.
    let marked = records.clone();
    *mailboxes.during_provision.lock().unwrap() = Some(Box::new(move || {
        marked.0.lock().unwrap()[0].state = AgentInboxState::Pausing;
    }));

    let inbox = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    assert_eq!(inbox.state, AgentInboxState::Paused);
    assert_eq!(records.only().state, AgentInboxState::Paused);
    assert!(mailboxes.calls().contains(&"pause".to_owned()));
}

#[tokio::test]
async fn removing_an_agent_that_never_had_an_inbox_asks_email_service_nothing() {
    // email_service is down: a removal must not depend on it here.
    let (service, records, mailboxes) = service(Answer::Down);

    service.pause(TEAM, &agent()).await.unwrap();

    assert!(mailboxes.calls().is_empty());
    assert_eq!(records.only().state, AgentInboxState::Paused);
}

#[tokio::test]
async fn taking_back_an_agent_that_never_had_an_inbox_asks_email_service_nothing() {
    let (service, records, mailboxes) = service(Answer::Down);

    service.release(TEAM, &agent()).await.unwrap();

    assert!(mailboxes.calls().is_empty());
    assert_eq!(records.only().state, AgentInboxState::Released);
}

#[tokio::test]
async fn a_pause_never_undoes_a_release() {
    let (service, records, mailboxes) = service(Answer::Active);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    records.0.lock().unwrap()[0].state = AgentInboxState::Releasing;

    service.pause(TEAM, &agent()).await.unwrap();

    assert_eq!(records.only().state, AgentInboxState::Releasing);
    assert!(!mailboxes.calls().iter().any(|call| call == "pause"));
}

#[tokio::test]
async fn a_removal_racing_a_provision_whose_pause_fails_is_finished_by_the_sweep() {
    let (service, records, mailboxes) = service(Answer::Active);
    // The removal marks the record while email_service is making the
    // mailbox, and email_service then fails the pause.
    let marked = records.clone();
    let fail_pause = mailboxes.fail_pause.clone();
    *mailboxes.during_provision.lock().unwrap() = Some(Box::new(move || {
        marked.0.lock().unwrap()[0].state = AgentInboxState::Pausing;
        *fail_pause.lock().unwrap() = true;
    }));

    let inbox = service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    assert_eq!(inbox.state, AgentInboxState::Pausing);
    assert_eq!(records.only().state, AgentInboxState::Pausing);

    *mailboxes.fail_pause.lock().unwrap() = false;
    let found = service
        .sweep_once(
            Utc::now() + SWEEP_AFTER + chrono::Duration::seconds(1),
            None,
            SWEEP_BATCH,
        )
        .await
        .unwrap();

    assert_eq!(found.found, 1);
    assert_eq!(records.only().state, AgentInboxState::Paused);
}

#[tokio::test]
async fn a_taken_back_invite_racing_a_provision_releases_what_it_made() {
    let (service, records, mailboxes) = service(Answer::Active);
    let marked = records.clone();
    *mailboxes.during_provision.lock().unwrap() = Some(Box::new(move || {
        marked.0.lock().unwrap()[0].state = AgentInboxState::Releasing;
    }));

    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    assert_eq!(records.only().state, AgentInboxState::Released);
    assert!(mailboxes.calls().contains(&"release".to_owned()));
    assert!(!mailboxes.calls().contains(&"pause".to_owned()));
}

#[tokio::test]
async fn a_release_email_service_is_still_finishing_stays_releasing_until_it_confirms() {
    let (service, records, mailboxes) = service(Answer::Active);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();
    *mailboxes.release_outcome.lock().unwrap() = ReleaseOutcome::Releasing;

    service.release(TEAM, &agent()).await.unwrap();
    assert_eq!(records.only().state, AgentInboxState::Releasing);

    *mailboxes.release_outcome.lock().unwrap() = ReleaseOutcome::Released;
    service
        .sweep_once(
            Utc::now() + SWEEP_AFTER + chrono::Duration::seconds(1),
            None,
            SWEEP_BATCH,
        )
        .await
        .unwrap();

    assert_eq!(records.only().state, AgentInboxState::Released);
}

#[tokio::test]
async fn deleting_a_team_releases_every_agents_inbox() {
    let (service, records, mailboxes) = service(Answer::Active);
    service
        .provision(TEAM, &agent(), "Sam Rivera", "sam-rivera")
        .await
        .unwrap();

    service.release_team(TEAM).await.unwrap();

    assert_eq!(records.only().state, AgentInboxState::Released);
    assert!(mailboxes.calls().contains(&"release".to_owned()));
}

#[tokio::test]
async fn the_sweep_pages_past_marks_it_cannot_finish_instead_of_spinning_on_them() {
    let (service, records, mailboxes) = service(Answer::Active);
    let later = Utc::now() + SWEEP_AFTER + chrono::Duration::seconds(1);
    for (slug, request) in [("ada", 1_u128), ("ben", 2)] {
        records.0.lock().unwrap().push(InboxRecord {
            agent: MacroUserIdStr::parse_from_str(&format!("macro|{slug}@agents.macro.invalid"))
                .unwrap()
                .into_owned(),
            team_id: TEAM,
            request_id: Uuid::from_u128(request),
            mailbox_id: Some(MAILBOX),
            address: None,
            state: AgentInboxState::Pausing,
            last_error: None,
            fake_provider: false,
            updated_at: Utc::now(),
        });
    }
    // email_service is down: neither mark can be finished.
    mailboxes.answer(Answer::Down);

    let first = service.sweep_once(later, None, 1).await.unwrap();
    let second = service
        .sweep_once(later, first.next.as_ref(), 1)
        .await
        .unwrap();
    let third = service
        .sweep_once(later, second.next.as_ref(), 1)
        .await
        .unwrap();

    assert_eq!((first.found, second.found, third.found), (1, 1, 0));
    assert_ne!(first.next, second.next);
    assert_eq!(third.next, None);
}
