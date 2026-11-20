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

use super::{Hold, ScreenError, ScreenService};
use crate::domain::models::{
    AgentNotice, EndReason, Lease, Mode, RedeemedTicket, Release, ScreenGrant, SessionId, Surface,
    TakeOver, TicketSecret, Transport,
};
use crate::domain::ports::{DriverSignal, ScreenRepo, TicketHash};
use crate::outbound::lease_changes::PgLeaseChanges;
use crate::outbound::pg::{PgScreenError, PgScreenRepo};

const COMPUTER: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(0xC0));

/// What the guest was told, in order.
#[derive(Clone, Default)]
struct RecordedSignal(Arc<Mutex<Vec<String>>>);

impl DriverSignal for RecordedSignal {
    async fn driving(&self, lease: &Lease) {
        self.0
            .lock()
            .unwrap()
            .push(format!("driving {}", lease.driver.user_id));
    }

    async fn released(&self, _computer: ComputerId) {
        self.0.lock().unwrap().push("released".to_owned());
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

    async fn take_notices(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Vec<AgentNotice>, PgScreenError> {
        self.inner.take_notices(agent).await
    }

    async fn user_name(&self, user: &MacroUserIdStr<'_>) -> Result<Option<String>, PgScreenError> {
        self.inner.user_name(user).await
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

async fn service(
    pool: PgPool,
) -> (
    Arc<ScreenService<ObservedRepo, RecordedSignal, PgLeaseChanges>>,
    RecordedSignal,
    Arc<Notify>,
) {
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
    );
    (Arc::new(service), signal, agent_lease_read)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_ticket_is_stored_hashed_and_redeems_once(pool: PgPool) {
    let (service, _, _) = service(pool.clone()).await;
    let ticket = service
        .issue_ticket(&grant(Mode::View), None)
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
        async move { service.hold_agent(&agent(), Duration::from_secs(60)).await }
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
    let notices = service.take_notices(&agent()).await.unwrap();
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[1].note.as_deref(), Some("done"));
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
