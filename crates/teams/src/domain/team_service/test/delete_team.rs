use std::collections::BTreeMap;

use bot_id::BotId;
use shared_entity_registry::RegisteredEntityType;
use uuid::Uuid;

use super::*;
use crate::domain::owned_entity_cleanup::{
    MAX_DISCOVERY_PASSES, OwnedEntityCleanup, OwnedEntityCleanupError, OwnedEntityCleanupUnwired,
    OwnedEntityRef, TeamDeletionOwner,
};

const TEAM_ID: Uuid = Uuid::from_u128(0x900);
const OWNER: &str = "macro|owner@example.com";
const SUBSCRIPTION: &str = "sub_team";

/// One effect of a team deletion, in the order the service caused it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Step {
    Purge(Uuid),
    CancelSubscription(String),
    DeleteTeam { team_id: Uuid, bot_ids: Vec<BotId> },
    Published(String),
}

/// The timeline that the cleanup fake and `test.rs`'s repository, customer
/// repository, and broker mocks append to, so ordering across ports is one
/// assertion.
#[derive(Clone, Default)]
pub(super) struct Journal(Arc<Mutex<Vec<Step>>>);

impl Journal {
    pub(super) fn record(&self, step: Step) {
        self.0.lock().unwrap().push(step);
    }

    fn steps(&self) -> Vec<Step> {
        self.0.lock().unwrap().clone()
    }
}

#[derive(Default)]
struct FakeWorld {
    /// Each team's bots, flagged when soft-deleted. The roster returns both,
    /// as the port requires.
    roster: BTreeMap<Uuid, Vec<(BotId, bool)>>,
    registry: BTreeMap<Uuid, OwnedEntityRef>,
    /// Entities a listing returns for an owner that does not own them.
    misfiled: Vec<(TeamDeletionOwner, OwnedEntityRef)>,
    fail_purge_of: Option<Uuid>,
    /// How many more purges register a fresh entity for the purged one's owner.
    respawns_left: usize,
    spawned: u128,
}

/// An in-memory bot roster and entity registry behind the cleanup port.
#[derive(Clone, Default)]
pub(super) struct RecordingOwnedEntityCleanup {
    journal: Journal,
    world: Arc<Mutex<FakeWorld>>,
}

impl RecordingOwnedEntityCleanup {
    fn new(journal: &Journal) -> Self {
        Self {
            journal: journal.clone(),
            world: Arc::default(),
        }
    }

    fn with_bot(self, team_id: Uuid, bot_id: BotId) -> Self {
        self.with_roster_entry(team_id, bot_id, false)
    }

    fn with_soft_deleted_bot(self, team_id: Uuid, bot_id: BotId) -> Self {
        self.with_roster_entry(team_id, bot_id, true)
    }

    fn with_roster_entry(self, team_id: Uuid, bot_id: BotId, soft_deleted: bool) -> Self {
        self.world
            .lock()
            .unwrap()
            .roster
            .entry(team_id)
            .or_default()
            .push((bot_id, soft_deleted));
        self
    }

    fn owning(
        self,
        owner: TeamDeletionOwner,
        entities: impl IntoIterator<Item = (RegisteredEntityType, Uuid)>,
    ) -> Self {
        let mut world = self.world.lock().unwrap();
        for (entity_type, id) in entities {
            world.registry.insert(
                id,
                OwnedEntityRef {
                    id,
                    entity_type,
                    owner,
                },
            );
        }
        drop(world);
        self
    }

    fn misfiling(self, listed_under: TeamDeletionOwner, entity: OwnedEntityRef) -> Self {
        self.world
            .lock()
            .unwrap()
            .misfiled
            .push((listed_under, entity));
        self
    }

    fn failing_purge_of(self, id: Uuid) -> Self {
        self.world.lock().unwrap().fail_purge_of = Some(id);
        self
    }

    fn respawning(self, times: usize) -> Self {
        self.world.lock().unwrap().respawns_left = times;
        self
    }

    fn heal(&self) {
        self.world.lock().unwrap().fail_purge_of = None;
    }

    fn remaining(&self) -> Vec<Uuid> {
        self.world
            .lock()
            .unwrap()
            .registry
            .keys()
            .copied()
            .collect()
    }
}

impl OwnedEntityCleanup for RecordingOwnedEntityCleanup {
    type Err = std::io::Error;

    async fn team_bots(&self, team_id: Uuid) -> Result<Vec<BotId>, Self::Err> {
        let world = self.world.lock().unwrap();
        Ok(world
            .roster
            .get(&team_id)
            .into_iter()
            .flatten()
            .map(|(bot_id, _soft_deleted)| *bot_id)
            .collect())
    }

    async fn owned_by(&self, owner: &TeamDeletionOwner) -> Result<Vec<OwnedEntityRef>, Self::Err> {
        let world = self.world.lock().unwrap();
        let recorded = world
            .registry
            .values()
            .filter(|entity| entity.owner == *owner);
        let misfiled = world
            .misfiled
            .iter()
            .filter(|(listed_under, _)| listed_under == owner)
            .map(|(_, entity)| entity);
        Ok(recorded.chain(misfiled).copied().collect())
    }

    async fn purge(&self, entity: &OwnedEntityRef) -> Result<(), Self::Err> {
        self.journal.record(Step::Purge(entity.id));
        let mut world = self.world.lock().unwrap();
        if world.fail_purge_of == Some(entity.id) {
            return Err(std::io::Error::other("injected purge failure"));
        }
        world.registry.remove(&entity.id);
        if world.respawns_left > 0 {
            world.respawns_left -= 1;
            let id = Uuid::from_u128(0x1000 + world.spawned);
            world.spawned += 1;
            world.registry.insert(id, OwnedEntityRef { id, ..*entity });
        }
        Ok(())
    }
}

fn scheduled_action(id: u128) -> (RegisteredEntityType, Uuid) {
    (RegisteredEntityType::ScheduledAction, Uuid::from_u128(id))
}

fn session(id: u128) -> (RegisteredEntityType, Uuid) {
    (RegisteredEntityType::AgentSession, Uuid::from_u128(id))
}

fn chat(id: u128) -> (RegisteredEntityType, Uuid) {
    (RegisteredEntityType::Chat, Uuid::from_u128(id))
}

fn document(id: u128) -> (RegisteredEntityType, Uuid) {
    (RegisteredEntityType::Document, Uuid::from_u128(id))
}

fn project(id: u128) -> (RegisteredEntityType, Uuid) {
    (RegisteredEntityType::Project, Uuid::from_u128(id))
}

fn bot(id: u128) -> BotId {
    BotId::new_from_uuid(Uuid::from_u128(id))
}

fn purge(id: u128) -> Step {
    Step::Purge(Uuid::from_u128(id))
}

fn cancel_subscription() -> Step {
    Step::CancelSubscription(SUBSCRIPTION.to_owned())
}

fn delete_team(bot_ids: Vec<BotId>) -> Step {
    Step::DeleteTeam {
        team_id: TEAM_ID,
        bot_ids,
    }
}

fn published_team_deleted() -> Step {
    Step::Published("team.deleted".to_owned())
}

fn owner_receipt() -> EntityAccessReceipt<OwnerTeamRole> {
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    test_team_receipt::<OwnerTeamRole>(TEAM_ID, &owner)
}

/// A paying team with one owner, whose repository, customer repository, and
/// broker record onto `journal`.
fn team_ports(
    journal: &Journal,
) -> (
    MockTeamRepository,
    MockCustomerRepository,
    RecordingEventBroker,
) {
    let mut repo = MockTeamRepository::new(Vec::new(), "Team", Arc::new(Mutex::new(Vec::new())));
    repo.team_members = vec![make_team_member(TEAM_ID, OWNER, TeamRole::Owner)];
    repo.team_subscription_id = Some(SUBSCRIPTION.parse().unwrap());
    repo.journal = journal.clone();
    let customer_repo = MockCustomerRepository {
        journal: journal.clone(),
        ..MockCustomerRepository::default()
    };
    let broker = RecordingEventBroker {
        journal: journal.clone(),
        ..RecordingEventBroker::default()
    };
    (repo, customer_repo, broker)
}

fn deleting_service(
    journal: &Journal,
    cleanup: &RecordingOwnedEntityCleanup,
) -> (impl TeamService, RecordingEventBroker) {
    let (repo, customer_repo, broker) = team_ports(journal);
    let service = TeamServiceImpl::new(
        repo,
        customer_repo,
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_event_broker(broker.clone())
    .with_owned_entity_cleanup(cleanup.clone());
    (service, broker)
}

fn cleanup_failure(result: Result<(), DeleteTeamError>) -> OwnedEntityCleanupError {
    match result {
        Err(DeleteTeamError::OwnedEntityCleanup(error)) => error,
        other => panic!("expected a cleanup failure, got {other:?}"),
    }
}

fn deleted_metadata(broker: &RecordingEventBroker) -> serde_json::Value {
    let events = broker.events();
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].envelope["event_type"], "team.deleted");
    events[0].envelope["metadata"].clone()
}

#[tokio::test]
async fn delete_team_purges_what_the_team_owns_directly() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal).owning(
        TeamDeletionOwner::Team(TEAM_ID),
        [chat(1), document(2), project(3)],
    );
    let (service, _broker) = deleting_service(&journal, &cleanup);

    service.delete_team(owner_receipt()).await.unwrap();

    assert_eq!(
        journal.steps(),
        vec![
            purge(1),
            purge(2),
            purge(3),
            cancel_subscription(),
            delete_team(Vec::new()),
            published_team_deleted(),
        ]
    );
}

#[tokio::test]
async fn delete_team_purges_what_the_teams_bots_own() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal)
        .with_bot(TEAM_ID, bot(0xb01))
        .owning(
            TeamDeletionOwner::Bot(bot(0xb01)),
            [session(1), document(2)],
        );
    let (service, _broker) = deleting_service(&journal, &cleanup);

    service.delete_team(owner_receipt()).await.unwrap();

    assert_eq!(
        journal.steps(),
        vec![
            purge(1),
            purge(2),
            cancel_subscription(),
            delete_team(vec![bot(0xb01)]),
            published_team_deleted(),
        ]
    );
}

#[tokio::test]
async fn delete_team_purges_what_soft_deleted_team_bots_own() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal)
        .with_bot(TEAM_ID, bot(0xb01))
        .with_soft_deleted_bot(TEAM_ID, bot(0xb02))
        .owning(
            TeamDeletionOwner::Bot(bot(0xb02)),
            [session(1), document(2)],
        );
    let (service, _broker) = deleting_service(&journal, &cleanup);

    service.delete_team(owner_receipt()).await.unwrap();

    assert_eq!(
        journal.steps(),
        vec![
            purge(1),
            purge(2),
            cancel_subscription(),
            delete_team(vec![bot(0xb01), bot(0xb02)]),
            published_team_deleted(),
        ]
    );
}

#[tokio::test]
async fn delete_team_purges_in_rank_order_before_billing_the_row_and_the_event() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal)
        .with_bot(TEAM_ID, bot(0xb01))
        .owning(
            TeamDeletionOwner::Team(TEAM_ID),
            [project(1), document(6), document(3), scheduled_action(5)],
        )
        .owning(TeamDeletionOwner::Bot(bot(0xb01)), [chat(2), session(4)]);
    let (service, _broker) = deleting_service(&journal, &cleanup);

    service.delete_team(owner_receipt()).await.unwrap();

    assert_eq!(
        journal.steps(),
        vec![
            purge(5),
            purge(4),
            purge(2),
            purge(3),
            purge(6),
            purge(1),
            cancel_subscription(),
            delete_team(vec![bot(0xb01)]),
            published_team_deleted(),
        ]
    );
}

#[tokio::test]
async fn delete_team_purges_content_created_while_it_purges() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal)
        .owning(TeamDeletionOwner::Team(TEAM_ID), [session(1)])
        .respawning(1);
    let (service, _broker) = deleting_service(&journal, &cleanup);

    service.delete_team(owner_receipt()).await.unwrap();

    assert_eq!(
        journal.steps(),
        vec![
            purge(1),
            purge(0x1000),
            cancel_subscription(),
            delete_team(Vec::new()),
            published_team_deleted(),
        ]
    );
}

#[tokio::test]
async fn delete_team_keeps_the_team_when_a_purge_fails_and_a_retry_resumes() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal)
        .owning(
            TeamDeletionOwner::Team(TEAM_ID),
            [
                document(1),
                document(2),
                document(3),
                document(4),
                document(5),
            ],
        )
        .failing_purge_of(Uuid::from_u128(3));
    let (service, broker) = deleting_service(&journal, &cleanup);

    let error = cleanup_failure(service.delete_team(owner_receipt()).await);

    assert!(
        matches!(
            error,
            OwnedEntityCleanupError::Purge {
                entity_type: RegisteredEntityType::Document,
                id,
                ..
            } if id == Uuid::from_u128(3)
        ),
        "{error:?}"
    );
    assert_eq!(journal.steps(), vec![purge(1), purge(2), purge(3)]);
    assert_eq!(
        cleanup.remaining(),
        vec![Uuid::from_u128(3), Uuid::from_u128(4), Uuid::from_u128(5)]
    );

    cleanup.heal();
    service.delete_team(owner_receipt()).await.unwrap();

    assert_eq!(
        journal.steps(),
        vec![
            purge(1),
            purge(2),
            purge(3),
            purge(3),
            purge(4),
            purge(5),
            cancel_subscription(),
            delete_team(Vec::new()),
            published_team_deleted(),
        ]
    );
    assert_eq!(
        deleted_metadata(&broker)["owned_entities"],
        serde_json::json!([
            {
                "entity_type": "document",
                "id": "00000000-0000-0000-0000-000000000003",
                "owner": "00000000-0000-0000-0000-000000000900",
            },
            {
                "entity_type": "document",
                "id": "00000000-0000-0000-0000-000000000004",
                "owner": "00000000-0000-0000-0000-000000000900",
            },
            {
                "entity_type": "document",
                "id": "00000000-0000-0000-0000-000000000005",
                "owner": "00000000-0000-0000-0000-000000000900",
            },
        ])
    );
}

#[tokio::test]
async fn delete_team_gives_up_while_content_keeps_reappearing() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal)
        .owning(TeamDeletionOwner::Team(TEAM_ID), [chat(1)])
        .respawning(usize::MAX);
    let (service, _broker) = deleting_service(&journal, &cleanup);

    let error = cleanup_failure(service.delete_team(owner_receipt()).await);

    assert!(
        matches!(
            error,
            OwnedEntityCleanupError::StillOwned { remaining: 1, passes }
                if passes == MAX_DISCOVERY_PASSES
        ),
        "{error:?}"
    );
    let steps = journal.steps();
    assert_eq!(
        steps.len(),
        usize::from(MAX_DISCOVERY_PASSES - 1),
        "{steps:?}"
    );
    assert!(
        steps.iter().all(|step| matches!(step, Step::Purge(_))),
        "{steps:?}"
    );
}

#[tokio::test]
async fn delete_team_without_a_cleanup_refuses_before_billing_or_the_row() {
    let journal = Journal::default();
    let (repo, customer_repo, broker) = team_ports(&journal);
    let service = TeamServiceImpl::new(
        repo,
        customer_repo,
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_event_broker(broker);

    let error = cleanup_failure(service.delete_team(owner_receipt()).await);

    let OwnedEntityCleanupError::ListBots { source } = &error else {
        panic!("expected the bot listing to fail, got {error:?}");
    };
    assert_eq!(
        source.downcast_ref::<OwnedEntityCleanupUnwired>(),
        Some(&OwnedEntityCleanupUnwired)
    );
    assert_eq!(journal.steps(), Vec::new());
}

#[tokio::test]
async fn delete_team_refuses_a_listing_that_returns_another_owners_entity() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal)
        .owning(TeamDeletionOwner::Team(TEAM_ID), [document(1)])
        .misfiling(
            TeamDeletionOwner::Team(TEAM_ID),
            OwnedEntityRef {
                id: Uuid::from_u128(2),
                entity_type: RegisteredEntityType::Document,
                owner: TeamDeletionOwner::Team(Uuid::from_u128(0x901)),
            },
        );
    let (service, _broker) = deleting_service(&journal, &cleanup);

    let error = cleanup_failure(service.delete_team(owner_receipt()).await);

    assert!(
        matches!(
            error,
            OwnedEntityCleanupError::OwnerMismatch {
                requested: TeamDeletionOwner::Team(requested),
                id,
            } if requested == TEAM_ID && id == Uuid::from_u128(2)
        ),
        "{error:?}"
    );
    assert_eq!(journal.steps(), Vec::new());
    assert_eq!(cleanup.remaining(), vec![Uuid::from_u128(1)]);
}

#[tokio::test]
async fn team_deleted_event_lists_the_bots_and_each_purged_entity_with_its_owner() {
    let journal = Journal::default();
    let cleanup = RecordingOwnedEntityCleanup::new(&journal)
        .with_bot(TEAM_ID, bot(0xb01))
        .owning(TeamDeletionOwner::Team(TEAM_ID), [project(2)])
        .owning(TeamDeletionOwner::Bot(bot(0xb01)), [document(1)]);
    let (service, broker) = deleting_service(&journal, &cleanup);

    service.delete_team(owner_receipt()).await.unwrap();

    let metadata = deleted_metadata(&broker);
    assert_eq!(
        metadata["bot_ids"],
        serde_json::json!(["00000000-0000-0000-0000-000000000b01"])
    );
    assert_eq!(
        metadata["owned_entities"],
        serde_json::json!([
            {
                "entity_type": "document",
                "id": "00000000-0000-0000-0000-000000000001",
                "owner": "bot|00000000-0000-0000-0000-000000000b01",
            },
            {
                "entity_type": "project",
                "id": "00000000-0000-0000-0000-000000000002",
                "owner": "00000000-0000-0000-0000-000000000900",
            },
        ])
    );
}
