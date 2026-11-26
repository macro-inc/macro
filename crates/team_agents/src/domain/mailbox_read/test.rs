//! In-process fixtures for human mailbox reads.

use std::sync::{Arc, Mutex};

use entity_access::domain::models::{BotId, BotReceiptScope, Entity};
use feature_flags::{FlagSnapshot, FlagValue};
use macro_authorization::CredentialOrigin;
use macro_user_id::cowlike::CowLike;
use model_user::UserContext;
use rootcause::Report;

use super::*;
use crate::domain::admission::AgentAccountFacts;

const TEAM: Uuid = Uuid::from_u128(1);
const MAILBOX: Uuid = Uuid::from_u128(2);
const THREAD: Uuid = Uuid::from_u128(3);
const VIEWER: &str = "macro|owner@example.com";
const AGENT: &str = "macro|teammate@example.com";
const ADDRESS: &str = "fixture@example.org";

fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(value).unwrap().into_owned()
}

fn team_receipt(viewer: &str, team: Uuid) -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(viewer),
        Entity {
            entity_id: team.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Owner,
        },
    )
    .unwrap()
}

fn session(viewer: &str) -> MacroUserAuthentication {
    MacroUserAuthentication {
        origin: CredentialOrigin::Session,
        agent_id: None,
        agent_via: None,
        routine_id: None,
        macro_user_id: user(viewer),
        user_context: UserContext::default(),
    }
}

fn viewer(viewer: &str, team: Uuid) -> MailboxViewer {
    MailboxViewer::new(&session(viewer), team_receipt(viewer, team)).unwrap()
}

#[derive(Clone)]
struct Fixture(Arc<Mutex<Data>>);

struct Data {
    role: Option<TeamRole>,
    flags: Option<(bool, bool)>,
    account: Option<AgentAccountFacts>,
    record: Option<InboxRecord>,
    mailbox: Option<MailboxIdentity>,
    address: String,
    list_calls: usize,
    thread_calls: usize,
    record_calls: usize,
    foreign_list_lookahead: bool,
    thread_fault: Option<ThreadFault>,
}

#[derive(Clone, Copy)]
enum ThreadFault {
    OtherThread,
    OtherMailbox,
    Outbound,
}

impl Fixture {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(Data {
            role: Some(TeamRole::Owner),
            flags: Some((true, true)),
            account: Some(AgentAccountFacts {
                team_id: TEAM,
                is_agent: true,
                member: true,
                created_by: Some(user(VIEWER)),
                created_by_is_agent: false,
            }),
            record: Some(InboxRecord {
                agent: user(AGENT),
                team_id: TEAM,
                request_id: Uuid::from_u128(6),
                mailbox_id: Some(MAILBOX),
                address: Some(ADDRESS.to_owned()),
                state: AgentInboxState::Active,
                last_error: None,
                fake_provider: true,
                updated_at: DateTime::UNIX_EPOCH,
            }),
            mailbox: Some(MailboxIdentity {
                team_id: TEAM,
                agent: user(AGENT),
                mailbox_id: MAILBOX,
            }),
            address: ADDRESS.to_owned(),
            list_calls: 0,
            thread_calls: 0,
            record_calls: 0,
            foreign_list_lookahead: false,
            thread_fault: None,
        })))
    }

    fn reader(&self) -> MailboxReader<Self, Self, Self> {
        MailboxReader::new(self.clone(), self.clone(), self.clone())
    }
}

impl AgentAccounts for Fixture {
    type Err = MailboxUnavailable;

    async fn account_facts(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<AgentAccountFacts>, Self::Err> {
        Ok((agent.as_ref() == AGENT)
            .then(|| self.0.lock().unwrap().account.clone())
            .flatten())
    }
}

impl FeatureFlags for Fixture {
    async fn load(&self, viewer: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        assert!(matches!(
            viewer.as_ref(),
            VIEWER | "macro|admin@example.com"
        ));
        let (teammates, inboxes) = self
            .0
            .lock()
            .unwrap()
            .flags
            .ok_or_else(|| Report::new(MailboxUnavailable))?;
        Ok(FlagSnapshot::new([
            (
                AGENT_TEAMMATES_FLAG.to_owned(),
                FlagValue::Boolean(teammates),
            ),
            (AGENT_INBOXES_FLAG.to_owned(), FlagValue::Boolean(inboxes)),
        ]))
    }
}

fn message(mailbox: &MailboxIdentity, id: u128, subject: &str, from: &str) -> MailboxMessage {
    MailboxMessage {
        mailbox: mailbox.clone(),
        inbound: true,
        summary: InboxMessage {
            id: Uuid::from_u128(id),
            thread_id: THREAD,
            from: from.to_owned(),
            subject: subject.to_owned(),
            received_at: DateTime::UNIX_EPOCH,
        },
        text: None,
    }
}

impl MailboxReadSource for Fixture {
    async fn human_role(
        &self,
        viewer: &MacroUserIdStr<'_>,
        team: Uuid,
    ) -> Result<Option<TeamRole>, MailboxUnavailable> {
        Ok(
            (team == TEAM && matches!(viewer.as_ref(), VIEWER | "macro|admin@example.com"))
                .then(|| self.0.lock().unwrap().role)
                .flatten(),
        )
    }

    async fn inbox_record(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<InboxRecord>, MailboxUnavailable> {
        assert_eq!(agent.as_ref(), AGENT);
        let mut data = self.0.lock().unwrap();
        data.record_calls += 1;
        Ok(data.record.clone())
    }

    async fn active_mailbox(
        &self,
        _mailbox: &MailboxIdentity,
    ) -> Result<Option<ActiveMailbox>, MailboxUnavailable> {
        let data = self.0.lock().unwrap();
        Ok(data.mailbox.clone().map(|identity| ActiveMailbox {
            identity,
            address: data.address.clone(),
        }))
    }

    async fn list(
        &self,
        mailbox: &MailboxIdentity,
        filter: &InboxFilter,
        after: Option<(DateTime<Utc>, Uuid)>,
        limit: u8,
    ) -> Result<Vec<MailboxMessage>, MailboxUnavailable> {
        let mut data = self.0.lock().unwrap();
        data.list_calls += 1;
        let mut outbound = message(mailbox, 9, "Status", "sender@example.com");
        outbound.inbound = false;
        let mut foreign = message(mailbox, 8, "Status", "sender@example.com");
        foreign.mailbox.mailbox_id = Uuid::from_u128(17);
        let mut rows: Vec<_> = [
            outbound,
            foreign,
            message(mailbox, 7, "Unrelated", "sender@example.com"),
            message(mailbox, 6, "Status", "other@example.com"),
            message(mailbox, 5, "Weekly status", "Sender@example.com"),
            message(mailbox, 4, "Status follow-up", "sender@example.com"),
        ]
        .into_iter()
        .filter(|row| {
            row.inbound
                && &row.mailbox == mailbox
                && filter.matches(&row.summary)
                && after.is_none_or(|after| row.summary.position() < after)
        })
        .take(usize::from(limit))
        .collect();
        if data.foreign_list_lookahead {
            rows[1].mailbox.mailbox_id = Uuid::from_u128(17);
        }
        Ok(rows)
    }

    async fn thread(
        &self,
        mailbox: &MailboxIdentity,
        thread: Uuid,
    ) -> Result<Vec<MailboxMessage>, MailboxUnavailable> {
        let mut data = self.0.lock().unwrap();
        data.thread_calls += 1;
        if thread != THREAD {
            return Ok(Vec::new());
        }
        let mut found = message(mailbox, 5, "Weekly status", "Sender@example.com");
        found.text = Some("Fixture body".to_owned());
        let mut rows = vec![found];
        if let Some(fault) = data.thread_fault {
            let mut foreign = message(mailbox, 4, "Status follow-up", "sender@example.com");
            match fault {
                ThreadFault::OtherThread => foreign.summary.thread_id = Uuid::from_u128(17),
                ThreadFault::OtherMailbox => foreign.mailbox.mailbox_id = Uuid::from_u128(17),
                ThreadFault::Outbound => foreign.inbound = false,
            }
            rows.push(foreign);
        }
        Ok(rows)
    }
}

#[tokio::test]
async fn address_requires_an_exact_active_binding_and_matches_the_provisioned_address() {
    let f = Fixture::new();
    let reader = f.reader();
    let agent = user(AGENT);
    let owner = viewer(VIEWER, TEAM);

    assert_eq!(
        reader.address(&owner, &agent).await,
        Ok(MailboxAddress::Provisioned(ADDRESS.to_owned()))
    );
    f.0.lock().unwrap().role = Some(TeamRole::Admin);
    assert_eq!(
        reader.address(&owner, &agent).await,
        Ok(MailboxAddress::Provisioned(ADDRESS.to_owned()))
    );

    f.0.lock().unwrap().record.as_mut().unwrap().state = AgentInboxState::Provisioning;
    assert_eq!(
        reader.address(&owner, &agent).await,
        Ok(MailboxAddress::InProgress)
    );
    f.0.lock().unwrap().record.as_mut().unwrap().state = AgentInboxState::Pausing;
    assert_eq!(
        reader.address(&owner, &agent).await,
        Ok(MailboxAddress::Unavailable)
    );

    f.0.lock().unwrap().record.as_mut().unwrap().state = AgentInboxState::Active;
    f.0.lock().unwrap().address = "different@example.org".to_owned();
    assert_eq!(
        reader.address(&owner, &agent).await,
        Ok(MailboxAddress::Unavailable)
    );
    f.0.lock().unwrap().address = ADDRESS.to_owned();
    f.0.lock().unwrap().mailbox.as_mut().unwrap().mailbox_id = Uuid::from_u128(19);
    assert_eq!(
        reader.address(&owner, &agent).await,
        Ok(MailboxAddress::Unavailable)
    );
    f.0.lock().unwrap().mailbox = None;
    assert_eq!(
        reader.address(&owner, &agent).await,
        Ok(MailboxAddress::Unavailable)
    );
}

#[test]
fn only_the_direct_personal_session_for_the_receipt_user_is_accepted() {
    let owner = session(VIEWER);
    let receipt = team_receipt(VIEWER, TEAM);
    let bot = EntityAccessReceipt::try_new_bot(
        BotId::new_from_uuid(Uuid::from_u128(23)).into_storage_id(),
        BotReceiptScope::User {
            acting_user: user(VIEWER),
        },
        receipt.entity().clone(),
        *receipt.entity_permission(),
    )
    .unwrap();
    assert!(matches!(
        MailboxViewer::new(&owner, bot),
        Err(MailboxUnavailable)
    ));

    for authentication in [
        MacroUserAuthentication {
            origin: CredentialOrigin::Internal,
            ..owner.clone()
        },
        MacroUserAuthentication {
            origin: CredentialOrigin::UserApiKey,
            ..owner.clone()
        },
        MacroUserAuthentication {
            routine_id: Some(Uuid::from_u128(29)),
            ..owner.clone()
        },
        MacroUserAuthentication {
            agent_id: Some(BotId::new_from_uuid(Uuid::from_u128(23))),
            ..owner.clone()
        },
        session("macro|admin@example.com"),
    ] {
        assert!(matches!(
            MailboxViewer::new(&authentication, team_receipt(VIEWER, TEAM)),
            Err(MailboxUnavailable)
        ));
    }
}

#[tokio::test]
async fn member_agent_and_foreign_team_have_no_mailbox_metadata() {
    let f = Fixture::new();
    let reader = f.reader();
    let agent = user(AGENT);
    let owner = viewer(VIEWER, TEAM);
    assert_eq!(
        reader.address(&viewer(AGENT, TEAM), &agent).await,
        Err(MailboxUnavailable)
    );
    assert_eq!(
        reader.address(&viewer(VIEWER, Uuid::nil()), &agent).await,
        Err(MailboxUnavailable)
    );

    f.0.lock().unwrap().role = Some(TeamRole::Member);
    assert_eq!(
        reader.address(&owner, &agent).await,
        Err(MailboxUnavailable)
    );
    assert_eq!(f.0.lock().unwrap().record_calls, 0);
}

#[tokio::test]
async fn both_human_rollouts_and_current_agent_membership_gate_all_reads() {
    let f = Fixture::new();
    let reader = f.reader();
    let agent = user(AGENT);
    let owner = viewer(VIEWER, TEAM);

    for flags in [Some((false, true)), Some((true, false)), None] {
        f.0.lock().unwrap().flags = flags;
        assert_eq!(
            reader.address(&owner, &agent).await,
            Err(MailboxUnavailable)
        );
    }
    f.0.lock().unwrap().flags = Some((true, true));
    f.0.lock().unwrap().account.as_mut().unwrap().team_id = Uuid::nil();
    assert_eq!(
        reader.address(&owner, &agent).await,
        Err(MailboxUnavailable)
    );

    {
        let mut data = f.0.lock().unwrap();
        let account = data.account.as_mut().unwrap();
        account.team_id = TEAM;
        account.member = false;
    }

    assert!(matches!(
        reader
            .list(&owner, &agent, InboxFilter::default(), None, 10)
            .await,
        Err(MailboxUnavailable)
    ));
    assert!(matches!(
        reader.thread(&owner, &agent, THREAD).await,
        Err(MailboxUnavailable)
    ));
    assert_eq!(f.0.lock().unwrap().record_calls, 0);
}

#[tokio::test]
async fn list_filters_before_count_and_continuation_and_rejects_other_query_scopes() {
    let f = Fixture::new();
    let reader = f.reader();
    let agent = user(AGENT);
    let owner = viewer(VIEWER, TEAM);
    let filter = InboxFilter::new(Some(" Status "), Some("SENDER@"));
    let page = reader
        .list(&owner, &agent, filter.clone(), None, 1)
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].subject, "Weekly status");
    let cursor = page.next.as_ref().unwrap();

    assert!(matches!(
        reader
            .list(&owner, &agent, InboxFilter::default(), Some(cursor), 1)
            .await,
        Err(MailboxUnavailable)
    ));
    assert!(matches!(
        reader
            .list(
                &viewer("macro|admin@example.com", TEAM),
                &agent,
                filter.clone(),
                Some(cursor),
                1
            )
            .await,
        Err(MailboxUnavailable)
    ));

    let next = reader
        .list(
            &owner,
            &agent,
            InboxFilter::new(Some("status"), Some("sender@")),
            Some(cursor),
            1,
        )
        .await
        .unwrap();
    assert_eq!(next.items.len(), 1);
    assert_eq!(next.items[0].subject, "Status follow-up");
    assert!(next.next.is_none());

    {
        let mut data = f.0.lock().unwrap();
        let replacement = Uuid::from_u128(21);
        data.record.as_mut().unwrap().mailbox_id = Some(replacement);
        data.mailbox.as_mut().unwrap().mailbox_id = replacement;
    }

    assert!(matches!(
        reader.list(&owner, &agent, filter, Some(cursor), 1).await,
        Err(MailboxUnavailable)
    ));
    assert_eq!(f.0.lock().unwrap().list_calls, 2);
}

#[tokio::test]
async fn a_foreign_list_lookahead_cannot_supply_a_page_or_continuation() {
    let f = Fixture::new();
    let reader = f.reader();
    f.0.lock().unwrap().foreign_list_lookahead = true;
    assert!(matches!(
        reader
            .list(
                &viewer(VIEWER, TEAM),
                &user(AGENT),
                InboxFilter::default(),
                None,
                1
            )
            .await,
        Err(MailboxUnavailable)
    ));
}

#[tokio::test]
async fn a_direct_thread_checks_authority_and_exact_membership_independently_of_list() {
    let f = Fixture::new();
    let reader = f.reader();
    let agent = user(AGENT);
    let owner = viewer(VIEWER, TEAM);
    let detail = reader.thread(&owner, &agent, THREAD).await.unwrap();
    assert_eq!(detail[0].text.as_deref(), Some("Fixture body"));

    f.0.lock().unwrap().role = None;
    assert!(matches!(
        reader.thread(&owner, &agent, THREAD).await,
        Err(MailboxUnavailable)
    ));
    assert_eq!(f.0.lock().unwrap().thread_calls, 1);

    f.0.lock().unwrap().role = Some(TeamRole::Owner);
    for fault in [
        ThreadFault::OtherThread,
        ThreadFault::OtherMailbox,
        ThreadFault::Outbound,
    ] {
        f.0.lock().unwrap().thread_fault = Some(fault);
        assert!(matches!(
            reader.thread(&owner, &agent, THREAD).await,
            Err(MailboxUnavailable)
        ));
    }
    assert!(matches!(
        reader.thread(&owner, &agent, Uuid::nil()).await,
        Err(MailboxUnavailable)
    ));
    assert_eq!(f.0.lock().unwrap().list_calls, 0);
}
