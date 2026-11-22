use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use computer_id::ComputerId;
use harness_id::HarnessId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

use super::{
    HOLD_RECHECK, Hold, MAX_SOCKETS_PER_VIEWER, MAX_TICKETS_PER_WINDOW, ScreenError, ScreenService,
    THAW_FAILURES_BEFORE_DEAD_MAN,
};
use crate::domain::models::{
    Access, AgentNotPaused, Caller, DriveEnd, DriveId, EndReason, Lease, Mode, NoticeName,
    OwedThaw, PendingNotice, Person, RedeemedTicket, Release, ScreenGrant, SessionId, Surface,
    TakeOver, ThawFailed, ThawSettled, Thawed, TicketRequest, TicketSecret, Transport,
};
use crate::domain::ports::{DriverSignal, People, ScreenAccess, ScreenRepo, TicketHash};
use crate::outbound::lease_changes::PgLeaseChanges;
use crate::outbound::pg::{PgScreenError, PgScreenRepo};

const COMPUTER: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(0xC0));

/// What the guest was told, in order; with `.1` set, its agent can't be
/// frozen; `.2` is how its next thaws fail (none: they work; `NotRunning`:
/// no computer runs); thaws on the computers in `.3` always fail.
#[derive(Clone, Default)]
struct RecordedSignal(
    Arc<Mutex<Vec<String>>>,
    Arc<AtomicBool>,
    Arc<Mutex<Option<ThawFailed>>>,
    Arc<Mutex<HashSet<ComputerId>>>,
);

impl DriverSignal for RecordedSignal {
    async fn driving(&self, lease: &Lease) -> Result<(), AgentNotPaused> {
        self.0
            .lock()
            .unwrap()
            .push(format!("driving {}", lease.driver.user_id));
        if self.1.load(Ordering::SeqCst) {
            Err(AgentNotPaused)
        } else {
            Ok(())
        }
    }

    async fn renewed(&self, _lease: &Lease) {
        self.0.lock().unwrap().push("renewed".to_owned());
    }

    async fn released(&self, _computer: ComputerId, _drive: DriveId) {
        self.0.lock().unwrap().push("released".to_owned());
    }

    async fn running(&self, computers: &[ComputerId]) -> Result<HashSet<ComputerId>, ThawFailed> {
        Ok(match *self.2.lock().unwrap() {
            Some(ThawFailed::NotRunning) => HashSet::new(),
            _ => computers.iter().copied().collect(),
        })
    }

    async fn thaw(&self, computer: ComputerId, _drive: &DriveId) -> Result<Thawed, ThawFailed> {
        if self.3.lock().unwrap().contains(&computer) {
            return Err(ThawFailed::Failed);
        }
        self.0.lock().unwrap().push("thaw".to_owned());
        match *self.2.lock().unwrap() {
            Some(failed) => Err(failed),
            None => Ok(Thawed::Running),
        }
    }
}

/// The Postgres repo, announcing each agent lease read once it returned.
struct ObservedRepo {
    inner: PgScreenRepo,
    agent_lease_read: Arc<Notify>,
}

impl ScreenRepo for ObservedRepo {
    type Err = PgScreenError;

    async fn insert_ticket(
        &self,
        hash: TicketHash,
        grant: &ScreenGrant,
        traceparent: Option<&str>,
        expires_at: DateTime<Utc>,
    ) -> Result<(), PgScreenError> {
        self.inner
            .insert_ticket(hash, grant, traceparent, expires_at)
            .await
    }

    async fn redeem_ticket(
        &self,
        hash: TicketHash,
    ) -> Result<Option<RedeemedTicket>, PgScreenError> {
        self.inner.redeem_ticket(hash).await
    }

    async fn start_session(&self, id: SessionId, grant: &ScreenGrant) -> Result<(), PgScreenError> {
        self.inner.start_session(id, grant).await
    }

    async fn end_session(
        &self,
        id: SessionId,
        reason: EndReason,
        bytes_to_viewer: u64,
        bytes_from_viewer: u64,
    ) -> Result<(), PgScreenError> {
        self.inner
            .end_session(id, reason, bytes_to_viewer, bytes_from_viewer)
            .await
    }

    async fn take_over(
        &self,
        grant: &ScreenGrant,
        session: SessionId,
        driver_name: Option<String>,
        ttl: Duration,
    ) -> Result<TakeOver, PgScreenError> {
        self.inner.take_over(grant, session, driver_name, ttl).await
    }

    async fn renew(
        &self,
        computer: ComputerId,
        session: SessionId,
        ttl: Duration,
    ) -> Result<Option<Lease>, PgScreenError> {
        self.inner.renew(computer, session, ttl).await
    }

    async fn release(
        &self,
        computer: ComputerId,
        release: Release,
    ) -> Result<Option<Lease>, PgScreenError> {
        self.inner.release(computer, release).await
    }

    async fn lease(&self, computer: ComputerId) -> Result<Option<Lease>, PgScreenError> {
        self.inner.lease(computer).await
    }

    async fn agent_lease(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<Lease>, PgScreenError> {
        let lease = self.inner.agent_lease(agent).await;
        self.agent_lease_read.notify_one();
        lease
    }

    async fn claim_notices(
        &self,
        agent: &MacroUserIdStr<'_>,
        kept: Duration,
        claim_for: Duration,
    ) -> Result<Vec<PendingNotice>, PgScreenError> {
        self.inner.claim_notices(agent, kept, claim_for).await
    }

    async fn delete_notices(&self, ids: &[Uuid]) -> Result<(), PgScreenError> {
        self.inner.delete_notices(ids).await
    }

    async fn unclaim_notices(&self, ids: &[Uuid]) -> Result<(), PgScreenError> {
        self.inner.unclaim_notices(ids).await
    }

    async fn lapsed_leases(&self) -> Result<Vec<ComputerId>, PgScreenError> {
        self.inner.lapsed_leases().await
    }

    async fn owed_thaws(&self) -> Result<Vec<OwedThaw>, PgScreenError> {
        self.inner.owed_thaws().await
    }

    async fn settle_thaw(&self, row: Uuid, settled: ThawSettled) -> Result<(), PgScreenError> {
        self.inner.settle_thaw(row, settled).await
    }

    async fn thaw_tried(&self, row: Uuid, failed: bool) -> Result<(), PgScreenError> {
        self.inner.thaw_tried(row, failed).await
    }

    async fn drive_end(
        &self,
        computer: ComputerId,
        started_at: DateTime<Utc>,
    ) -> Result<Option<DriveEnd>, PgScreenError> {
        self.inner.drive_end(computer, started_at).await
    }

    async fn open_sockets(
        &self,
        computer: ComputerId,
        user: &MacroUserIdStr<'_>,
        fresh: Duration,
    ) -> Result<(u32, u32), PgScreenError> {
        self.inner.open_sockets(computer, user, fresh).await
    }

    async fn end_lost_sessions(
        &self,
        computer: ComputerId,
        fresh: Duration,
    ) -> Result<u64, PgScreenError> {
        self.inner.end_lost_sessions(computer, fresh).await
    }

    async fn touch_session(&self, id: SessionId) -> Result<(), PgScreenError> {
        self.inner.touch_session(id).await
    }

    async fn computers_in_use(
        &self,
        computers: &[ComputerId],
        fresh: Duration,
    ) -> Result<Vec<ComputerId>, PgScreenError> {
        self.inner.computers_in_use(computers, fresh).await
    }
}

/// The harness's answer for every caller, and the rollout's.
#[derive(Clone)]
struct FixedAccess {
    rollout: bool,
    access: Access,
}

impl ScreenAccess for FixedAccess {
    type Err = std::convert::Infallible;

    async fn rollout(&self, _user: &MacroUserIdStr<'static>) -> bool {
        self.rollout
    }

    async fn authorize(
        &self,
        _user: &MacroUserIdStr<'static>,
        _harness: HarnessId,
        _mode: Mode,
    ) -> Result<Access, Self::Err> {
        Ok(self.access)
    }

    async fn agent_of(
        &self,
        _computer: ComputerId,
    ) -> Result<Option<MacroUserIdStr<'static>>, Self::Err> {
        Ok(Some(agent()))
    }
}

/// People: everyone is a person named Alice, except the agent accounts.
struct FixedPeople {
    agents: Vec<String>,
}

impl People for FixedPeople {
    type Err = std::convert::Infallible;

    async fn person(&self, user: &MacroUserIdStr<'_>) -> Result<Option<Person>, Self::Err> {
        Ok(Some(Person {
            name: Some("Alice".to_owned()),
            is_agent: self.agents.iter().any(|agent| agent == user.as_ref()),
        }))
    }
}

type Service =
    ScreenService<ObservedRepo, RecordedSignal, PgLeaseChanges, FixedAccess, FixedPeople>;

fn granted() -> FixedAccess {
    FixedAccess {
        rollout: true,
        access: Access::Granted(COMPUTER),
    }
}

fn request(mode: Mode) -> TicketRequest {
    TicketRequest {
        harness_id: HarnessId::TEST_A,
        user_id: MacroUserIdStr::try_from("macro|alice@example.com".to_owned()).unwrap(),
        caller: Caller::Person,
        transport: Transport::Vnc,
        surface: Surface::Desktop,
        mode,
    }
}

fn agent() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|scout@example.com".to_owned()).unwrap()
}

fn grant(mode: Mode) -> ScreenGrant {
    ScreenGrant {
        harness_id: HarnessId::TEST_A,
        computer_id: COMPUTER,
        agent_user_id: Some(agent()),
        user_id: MacroUserIdStr::try_from("macro|alice@example.com".to_owned()).unwrap(),
        transport: Transport::Vnc,
        surface: Surface::Desktop,
        mode,
    }
}

async fn service(pool: PgPool) -> (Arc<Service>, RecordedSignal, Arc<Notify>) {
    service_with(pool, granted()).await
}

async fn service_with(
    pool: PgPool,
    access: FixedAccess,
) -> (Arc<Service>, RecordedSignal, Arc<Notify>) {
    let signal = RecordedSignal::default();
    let agent_lease_read = Arc::new(Notify::new());
    let changes =
        PgLeaseChanges::listen(pool.clone(), &TaskTracker::new(), CancellationToken::new()).await;
    let service = ScreenService::new(
        ObservedRepo {
            inner: PgScreenRepo::new(pool),
            agent_lease_read: Arc::clone(&agent_lease_read),
        },
        signal.clone(),
        changes,
        access,
        FixedPeople {
            agents: vec![agent().as_ref().to_owned()],
        },
    );
    (Arc::new(service), signal, agent_lease_read)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_ticket_is_stored_hashed_and_redeems_once(pool: PgPool) {
    let (service, _, _) = service(pool.clone()).await;
    let ticket = service
        .issue_ticket(request(Mode::View), None)
        .await
        .unwrap();

    let stored: Vec<u8> = sqlx::query_scalar!("SELECT token_hash FROM computer_screen_tickets")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(stored, ticket.secret.expose().as_bytes());
    assert_eq!(
        service
            .redeem(&ticket.secret)
            .await
            .unwrap()
            .map(|redeemed| redeemed.grant),
        Some(grant(Mode::View))
    );
    assert_eq!(service.redeem(&ticket.secret).await.unwrap(), None);
    assert_eq!(
        service
            .redeem(&TicketSecret::new("made-up".to_owned()))
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_view_ticket_cannot_take_over(pool: PgPool) {
    let (service, signal, _) = service(pool).await;
    let viewer = grant(Mode::View);
    let session = service.open_session(&viewer).await.unwrap();

    let refused = service.take_over(&viewer, session).await;

    assert!(matches!(refused, Err(ScreenError::DriveNotAllowed)));
    assert!(signal.0.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_agent_goes_straight_through_when_nobody_drives(pool: PgPool) {
    let (service, _, _) = service(pool).await;

    let hold = service
        .hold_agent(&agent(), Duration::from_secs(5))
        .await
        .unwrap();

    assert_eq!(hold, Hold::Free);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_agent_waits_for_the_hand_back(pool: PgPool) {
    let (service, signal, agent_lease_read) = service(pool).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    assert!(matches!(
        service.take_over(&driver, session).await.unwrap(),
        TakeOver::Taken(_)
    ));

    let held = tokio::spawn({
        let service = Arc::clone(&service);
        // Shorter than the safety re-check: only the hand-back's NOTIFY can
        // release it in time.
        async move { service.hold_agent(&agent(), HOLD_RECHECK / 3).await }
    });
    // The hold has seen the live lease; the hand-back's NOTIFY wakes it.
    agent_lease_read.notified().await;
    service
        .hand_back(COMPUTER, driver.user_id.clone(), Some("done".to_owned()))
        .await
        .unwrap();

    assert!(matches!(
        held.await.unwrap().unwrap(),
        Hold::Released { .. }
    ));
    assert_eq!(
        *signal.0.lock().unwrap(),
        vec![
            "driving macro|alice@example.com".to_owned(),
            "released".to_owned()
        ]
    );
    let notices = service.claim_notices(&agent()).await.unwrap();
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[1].notice.note.as_deref(), Some("done"));
    let ids: Vec<Uuid> = notices.iter().map(|pending| pending.id).collect();
    service.notices_delivered(&ids).await.unwrap();
    assert!(service.claim_notices(&agent()).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_take_over_that_cannot_freeze_the_agent_never_starts(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    signal.1.store(true, Ordering::SeqCst);
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();

    let taken = service.take_over(&driver, session).await;

    assert!(
        matches!(taken, Err(ScreenError::AgentNotPausable)),
        "{taken:?}"
    );
    assert_eq!(service.lease(COMPUTER).await.unwrap(), None);
    assert_eq!(
        *signal.0.lock().unwrap(),
        vec![
            "driving macro|alice@example.com".to_owned(),
            "released".to_owned()
        ]
    );
    // The agent never paused, so it hears of neither end.
    assert!(service.claim_notices(&agent()).await.unwrap().is_empty());
    let ended = sqlx::query_scalar!("SELECT end_reason FROM computer_screen_drives")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ended.as_deref(), Some("refused"));
}

/// Ended drives whose agent's thaw the guest hasn't answered.
async fn owed(pool: &PgPool) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "owed!" FROM computer_screen_drives WHERE ended_at IS NOT NULL AND thaw_settled_at IS NULL"#
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A lease nobody read lapses and is released by the next round, which
/// then confirms the thaw.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reaping_releases_a_lapsed_lease_and_thaws_its_agent(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, session).await.unwrap();
    sqlx::query!(
        "UPDATE computer_screen_driver_leases SET expires_at = now() - interval '1 second'"
    )
    .execute(&pool)
    .await
    .unwrap();

    service.reap().await.unwrap();

    assert_eq!(service.lease(COMPUTER).await.unwrap(), None);
    assert_eq!(
        *signal.0.lock().unwrap(),
        vec![
            "driving macro|alice@example.com".to_owned(),
            "released".to_owned(),
            "thaw".to_owned()
        ]
    );
    assert_eq!(owed(&pool).await, 0);
}

/// A thaw that never landed is owed for good: however long ago the drive
/// ended, the next round thaws it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_thaw_that_never_landed_is_retried_however_long_ago(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, session).await.unwrap();
    *signal.2.lock().unwrap() = Some(ThawFailed::Failed);
    service
        .hand_back(COMPUTER, driver.user_id.clone(), None)
        .await
        .unwrap();
    service.reap().await.unwrap();
    assert_eq!(owed(&pool).await, 1);
    sqlx::query!("UPDATE computer_screen_drives SET ended_at = now() - interval '3 days'")
        .execute(&pool)
        .await
        .unwrap();

    *signal.2.lock().unwrap() = None;
    service.reap().await.unwrap();

    assert_eq!(owed(&pool).await, 0);
}

/// A computer that sleeps while its agent is frozen keeps the thaw owed
/// (and may sleep: its own timer thaws the agent on resume); once it runs
/// again, the next round thaws it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_computer_asleep_while_frozen_is_thawed_once_it_runs(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, session).await.unwrap();
    *signal.2.lock().unwrap() = Some(ThawFailed::NotRunning);
    service
        .hand_back(COMPUTER, driver.user_id.clone(), None)
        .await
        .unwrap();
    service
        .close_session(session, EndReason::Stopped, 0, 0)
        .await
        .unwrap();

    service.reap().await.unwrap();
    assert_eq!(owed(&pool).await, 1);
    let repo = PgScreenRepo::new(pool.clone());
    assert!(
        repo.computers_in_use(&[COMPUTER], Duration::from_secs(120))
            .await
            .unwrap()
            .is_empty(),
        "an owed thaw doesn't keep the computer awake"
    );

    *signal.2.lock().unwrap() = None;
    service.reap().await.unwrap();

    assert_eq!(owed(&pool).await, 0);
}

/// A thaw that keeps failing while the computer runs stops being retried
/// once the guest's own timer has certainly thawed the agent.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_thaw_failing_past_the_guests_timer_settles(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, session).await.unwrap();
    *signal.2.lock().unwrap() = Some(ThawFailed::Failed);
    service
        .hand_back(COMPUTER, driver.user_id.clone(), None)
        .await
        .unwrap();

    // Every replica counts failures, so enough of them can pile up before
    // the guest's timer can have fired: they don't settle the thaw yet.
    for round in 0..=THAW_FAILURES_BEFORE_DEAD_MAN {
        service.reap().await.unwrap();
        assert_eq!(owed(&pool).await, 1, "round {round}");
    }
    sqlx::query!(
        "UPDATE computer_screen_drives SET thaw_first_failed_at = now() - interval '10 minutes'"
    )
    .execute(&pool)
    .await
    .unwrap();
    service.reap().await.unwrap();

    assert_eq!(owed(&pool).await, 0);
    let settled = sqlx::query_scalar!("SELECT thaw_settled FROM computer_screen_drives")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(settled.as_deref(), Some("deadMan"));
}

/// A thaw owed for over a week settles without asking the guest.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_owed_thaw_expires(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, session).await.unwrap();
    *signal.2.lock().unwrap() = Some(ThawFailed::NotRunning);
    service
        .hand_back(COMPUTER, driver.user_id.clone(), None)
        .await
        .unwrap();
    sqlx::query!("UPDATE computer_screen_drives SET ended_at = now() - interval '8 days'")
        .execute(&pool)
        .await
        .unwrap();

    service.reap().await.unwrap();

    assert_eq!(owed(&pool).await, 0);
    let settled = sqlx::query_scalar!("SELECT thaw_settled FROM computer_screen_drives")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(settled.as_deref(), Some("expired"));
}

/// 501 thaws that never land (an old image, a broken guest) rotate behind
/// a new one, which still settles in the next round.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_backlog_of_dead_thaws_never_starves_a_new_one(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let stuck = ComputerId::new_from_uuid(Uuid::from_u128(0xDEAD));
    signal.3.lock().unwrap().insert(stuck);
    let session = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO computer_screen_sessions (id, harness_id, computer_id, user_id, transport, surface, mode)
        VALUES ($1, $2, $3, 'macro|alice@example.com', 'vnc', 'desktop', 'drive')
        "#,
        session,
        HarnessId::TEST_A.as_uuid(),
        stuck.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO computer_screen_drives (id, computer_id, session_id, user_id, started_at, ended_at, end_reason, thaw_tried_at)
        SELECT gen_random_uuid(), $1, $2, 'macro|alice@example.com',
               now() - make_interval(mins => n + 10), now() - make_interval(mins => n), 'lapsed',
               now() - make_interval(secs => n)
        FROM generate_series(1, 501) AS n
        "#,
        stuck.as_uuid(),
        session,
    )
    .execute(&pool)
    .await
    .unwrap();
    let driver = grant(Mode::Drive);
    let live = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, live).await.unwrap();
    service
        .hand_back(COMPUTER, driver.user_id.clone(), None)
        .await
        .unwrap();

    service.reap().await.unwrap();

    let settled = sqlx::query_scalar!(
        "SELECT thaw_settled FROM computer_screen_drives WHERE computer_id = $1",
        COMPUTER.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(settled.as_deref(), Some("thawed"));
}

/// A renewal that found the agent unfrozen freezes it again while its drive
/// is live, and never for a drive that ended or was taken over since.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unfrozen_drive_is_frozen_again_only_while_live(pool: PgPool) {
    let (service, signal, _) = service(pool).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    let TakeOver::Taken(lease) = service.take_over(&driver, session).await.unwrap() else {
        panic!("not taken");
    };

    service.refreeze(COMPUTER, &lease.drive_id()).await.unwrap();
    assert_eq!(
        signal.0.lock().unwrap().last().map(String::as_str),
        Some("driving macro|alice@example.com")
    );
    assert!(service.lease(COMPUTER).await.unwrap().is_some());

    service
        .hand_back(COMPUTER, driver.user_id.clone(), None)
        .await
        .unwrap();
    let told = signal.0.lock().unwrap().len();
    service.refreeze(COMPUTER, &lease.drive_id()).await.unwrap();
    assert_eq!(
        signal.0.lock().unwrap().len(),
        told,
        "a drive that ended was frozen again"
    );
}

/// When the agent can't be frozen again either, the drive ends.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unfrozen_drive_that_cannot_refreeze_ends(pool: PgPool) {
    let (service, signal, _) = service(pool).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    let TakeOver::Taken(lease) = service.take_over(&driver, session).await.unwrap() else {
        panic!("not taken");
    };
    signal.1.store(true, Ordering::SeqCst);

    service.refreeze(COMPUTER, &lease.drive_id()).await.unwrap();

    assert_eq!(service.lease(COMPUTER).await.unwrap(), None);
    assert_eq!(
        service.drive_end(&lease).await.unwrap(),
        Some(DriveEnd::Unpaused)
    );
}

/// When the guest let the agent run mid-drive and it can't be frozen again,
/// the drive ends as unpaused, with the agent's hand-back notice; a stale
/// report about another drive changes nothing.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lost_freeze_ends_its_drive(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    let TakeOver::Taken(lease) = service.take_over(&driver, session).await.unwrap() else {
        panic!("not taken");
    };
    let other = DriveId::of(COMPUTER, lease.started_at - chrono::Duration::seconds(5));

    service.freeze_lost(COMPUTER, &other).await.unwrap();
    assert!(service.lease(COMPUTER).await.unwrap().is_some());

    service
        .freeze_lost(COMPUTER, &lease.drive_id())
        .await
        .unwrap();

    assert_eq!(service.lease(COMPUTER).await.unwrap(), None);
    assert_eq!(
        service.drive_end(&lease).await.unwrap(),
        Some(DriveEnd::Unpaused)
    );
    assert_eq!(
        signal.0.lock().unwrap().last().map(String::as_str),
        Some("released")
    );
    let notices = service.claim_notices(&agent()).await.unwrap();
    assert_eq!(
        notices
            .iter()
            .map(|pending| pending.notice.name)
            .collect::<Vec<_>>(),
        vec![NoticeName::TakeOver, NoticeName::HandBack]
    );
}

/// Driver input renews the lease and keeps the agent frozen in the guest.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_renewal_keeps_the_agent_frozen(pool: PgPool) {
    let (service, signal, _) = service(pool).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, session).await.unwrap();

    service.renew(COMPUTER, session).await.unwrap();

    assert_eq!(
        signal.0.lock().unwrap().last().map(String::as_str),
        Some("renewed")
    );
}

/// The same driver moving to another tab keeps a drive the agent already
/// heard of; if the freeze fails then, the drive ends as a hand-back with
/// its notice, never as a refusal.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_moved_drive_that_cannot_refreeze_hands_back(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let driver = grant(Mode::Drive);
    let first = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, first).await.unwrap();
    signal.1.store(true, Ordering::SeqCst);
    let second = service.open_session(&driver).await.unwrap();

    let moved = service.take_over(&driver, second).await;

    assert!(
        matches!(moved, Err(ScreenError::AgentNotPausable)),
        "{moved:?}"
    );
    let ended = sqlx::query_scalar!("SELECT end_reason FROM computer_screen_drives")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ended.as_deref(), Some("handBack"));
    let notices = service.claim_notices(&agent()).await.unwrap();
    assert_eq!(
        notices
            .iter()
            .map(|pending| pending.notice.name)
            .collect::<Vec<_>>(),
        vec![NoticeName::TakeOver, NoticeName::HandBack]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_hold_gives_up_at_its_bound(pool: PgPool) {
    let (service, _, _) = service(pool).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, session).await.unwrap();

    let hold = service
        .hold_agent(&agent(), Duration::from_millis(50))
        .await
        .unwrap();

    assert_eq!(hold, Hold::TimedOut);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lapsed_lease_releases_the_agent_and_tells_the_guest(pool: PgPool) {
    let (service, signal, _) = service(pool.clone()).await;
    let driver = grant(Mode::Drive);
    let session = service.open_session(&driver).await.unwrap();
    service.take_over(&driver, session).await.unwrap();
    sqlx::query!(
        "UPDATE computer_screen_driver_leases SET expires_at = now() - interval '1 second'"
    )
    .execute(&pool)
    .await
    .unwrap();

    let hold = service
        .hold_agent(&agent(), Duration::from_secs(5))
        .await
        .unwrap();

    assert_eq!(hold, Hold::Free);
    assert_eq!(service.lease(COMPUTER).await.unwrap(), None);
    assert_eq!(
        signal.0.lock().unwrap().last().map(String::as_str),
        Some("released")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_program_never_gets_a_ticket_to_watch_or_drive(pool: PgPool) {
    let (service, _, _) = service(pool).await;
    for mode in [Mode::View, Mode::Drive] {
        let mut asked = request(mode);
        asked.caller = Caller::Program;

        assert!(matches!(
            service.issue_ticket(asked, None).await,
            Err(ScreenError::ProgramRefused)
        ));
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_account_never_gets_a_ticket(pool: PgPool) {
    let (service, _, _) = service(pool).await;
    let mut asked = request(Mode::View);
    asked.user_id = agent();

    assert!(matches!(
        service.issue_ticket(asked, None).await,
        Err(ScreenError::AgentRefused)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_rollout_and_the_harness_decide_who_gets_a_ticket(pool: PgPool) {
    let (outside, _, _) = service_with(
        pool.clone(),
        FixedAccess {
            rollout: false,
            access: Access::Granted(COMPUTER),
        },
    )
    .await;
    assert!(matches!(
        outside.issue_ticket(request(Mode::View), None).await,
        Err(ScreenError::RolloutDisabled)
    ));
    // A socket of someone the rollout dropped ends at its next check.
    assert!(!outside.reauthorize(&grant(Mode::View)).await.unwrap());

    let (denied, _, _) = service_with(
        pool,
        FixedAccess {
            rollout: true,
            access: Access::Denied,
        },
    )
    .await;
    assert!(matches!(
        denied.issue_ticket(request(Mode::Drive), None).await,
        Err(ScreenError::NoAccess)
    ));
    assert!(!denied.reauthorize(&grant(Mode::Drive)).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_gets_only_so_many_tickets_a_minute(pool: PgPool) {
    let (service, _, _) = service(pool).await;
    for _ in 0..MAX_TICKETS_PER_WINDOW {
        service
            .issue_ticket(request(Mode::View), None)
            .await
            .unwrap();
    }

    assert!(matches!(
        service.issue_ticket(request(Mode::View), None).await,
        Err(ScreenError::TooManyTickets)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_opens_only_so_many_sockets_on_a_computer(pool: PgPool) {
    let (service, _, _) = service(pool).await;
    let viewer = grant(Mode::View);
    for _ in 0..MAX_SOCKETS_PER_VIEWER {
        service.open_session(&viewer).await.unwrap();
    }

    assert!(matches!(
        service.open_session(&viewer).await,
        Err(ScreenError::TooManySockets)
    ));
    // Someone else still gets in.
    let mut other = grant(Mode::View);
    other.user_id = MacroUserIdStr::try_from("macro|bob@example.com".to_owned()).unwrap();
    service.open_session(&other).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn watchers_never_lock_a_driver_out_of_a_full_computer(pool: PgPool) {
    let (service, _, _) = service(pool).await;
    let person = |name: &str, mode: Mode| {
        let mut grant = grant(mode);
        grant.user_id = MacroUserIdStr::try_from(format!("macro|{name}@example.com")).unwrap();
        grant
    };
    let full = super::MAX_SOCKETS_PER_COMPUTER / MAX_SOCKETS_PER_VIEWER;
    for index in 0..full {
        let watcher = person(&format!("watcher{index}"), Mode::View);
        for _ in 0..MAX_SOCKETS_PER_VIEWER {
            service.open_session(&watcher).await.unwrap();
        }
    }

    assert!(matches!(
        service.open_session(&person("late", Mode::View)).await,
        Err(ScreenError::TooManySockets)
    ));
    service
        .open_session(&person("owner", Mode::Drive))
        .await
        .unwrap();
}
