use super::*;
use macro_user_id::cowlike::CowLike;

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@test.com"))
        .unwrap()
        .into_owned()
}
fn state(name: &str) -> SyncState {
    SyncState {
        id: macro_uuid::generate_uuid_v7(),
        user_id: user(name),
        scope: Scope::All,
        enabled: true,
        has_endpoint: true,
        started_at: chrono::Utc::now(),
        last_error: None,
    }
}

#[test]
fn connecting_an_account_starts_sync_without_user_action() {
    let plan = plan(&[user("a")], &[], chrono::Utc::now());
    assert_eq!(plan.start, vec![user("a")]);
    assert!(plan.stop.is_empty());
}

#[test]
fn an_active_sync_at_the_widest_scope_is_left_alone() {
    let plan = plan(&[user("a")], &[state("a")], chrono::Utc::now());
    assert_eq!(plan, Plan::default());
}

#[test]
fn removing_the_connection_stops_its_sync() {
    let removed = state("a");
    let removed_id = removed.id;
    let plan = plan(&[user("b")], &[removed, state("b")], chrono::Utc::now());
    assert_eq!(plan.stop, vec![removed_id]);
    assert!(plan.start.is_empty());
}

#[test]
fn narrower_scopes_from_earlier_settings_are_widened() {
    let plan = plan(
        &[user("a")],
        &[SyncState {
            scope: Scope::Personal,
            ..state("a")
        }],
        chrono::Utc::now(),
    );
    assert_eq!(plan.start, vec![user("a")]);
}

#[test]
fn failed_setups_wait_for_the_retry_delay_but_reconnects_restart_at_once() {
    let now = chrono::Utc::now();
    let failed = |issue: SyncIssue, age: chrono::Duration| SyncState {
        enabled: false,
        has_endpoint: false,
        started_at: now - age,
        last_error: Some(issue),
        ..state("a")
    };
    let accounts = [user("a")];
    let recent = failed(SyncIssue::SetupFailed, chrono::Duration::minutes(5));
    assert!(plan(&accounts, &[recent], now).start.is_empty());
    let old = failed(SyncIssue::SetupFailed, chrono::Duration::hours(2));
    assert_eq!(plan(&accounts, &[old], now).start.len(), 1);
    let stopped = failed(SyncIssue::Stopped, chrono::Duration::minutes(1));
    assert_eq!(plan(&accounts, &[stopped], now).start.len(), 1);
}

#[test]
fn an_in_flight_reservation_is_not_raced() {
    let now = chrono::Utc::now();
    let reserving = |age| SyncState {
        enabled: false,
        has_endpoint: false,
        started_at: now - age,
        ..state("a")
    };
    let accounts = [user("a")];
    let fresh = reserving(chrono::Duration::seconds(10));
    assert!(plan(&accounts, &[fresh], now).start.is_empty());
    let abandoned = reserving(chrono::Duration::minutes(5));
    assert_eq!(plan(&accounts, &[abandoned], now).start.len(), 1);
}

// Reconcile, over the connectors services' shared fake.

use crate::outbound::accounts::ConnectedAccounts;
use call::domain::imports::{ImportedCall, ImportedCallPreview, ImportedCallRecord};
use call::domain::records::{CallEntityRecord, CallProvider};
use connectors::fake::{FakeConnection, FakeConnectors};
use std::sync::Mutex;

/// Sync rows in memory, recording which syncs were stopped.
#[derive(Default)]
struct FakeRepo {
    connections: Mutex<Vec<Connection>>,
    stopped: Mutex<Vec<Uuid>>,
}

impl FakeRepo {
    fn syncing(user: MacroUserIdStr<'static>) -> Self {
        let repo = Self::default();
        repo.connections.lock().unwrap().push(Connection {
            id: macro_uuid::generate_uuid_v7(),
            namespace: macro_uuid::generate_uuid_v7(),
            user_id: user,
            scope: Scope::All,
            enabled: true,
            endpoint_id: Some("endpoint".to_owned()),
            secret: Some(SigningSecret("secret".to_owned())),
            started_at: chrono::Utc::now(),
            last_synced_at: None,
            last_error: None,
        });
        repo
    }
}

#[async_trait]
impl SyncRepository for FakeRepo {
    async fn by_user(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Connection>> {
        let connections = self.connections.lock().unwrap();
        Ok(connections.iter().find(|c| &c.user_id == user).cloned())
    }
    async fn by_id(&self, id: Uuid) -> Result<Option<Connection>> {
        let connections = self.connections.lock().unwrap();
        Ok(connections.iter().find(|c| c.id == id).cloned())
    }
    async fn states(&self) -> Result<Vec<SyncState>> {
        let connections = self.connections.lock().unwrap();
        Ok(connections
            .iter()
            .map(|c| SyncState {
                id: c.id,
                user_id: c.user_id.clone(),
                scope: c.scope,
                enabled: c.enabled,
                has_endpoint: c.endpoint_id.is_some(),
                started_at: c.started_at,
                last_error: c.last_error,
            })
            .collect())
    }
    async fn reserve(&self, _connection: &Connection) -> Result<bool> {
        Ok(false)
    }
    async fn activate(&self, _id: Uuid, _webhook: Webhook, _scope: Scope) -> Result<bool> {
        Ok(false)
    }
    async fn stop(&self, id: Uuid) -> Result<()> {
        self.stopped.lock().unwrap().push(id);
        Ok(())
    }
    async fn failed_setup(&self, _id: Uuid) -> Result<()> {
        Ok(())
    }
    async fn enqueue(&self, _id: Uuid, _event: Event) -> Result<()> {
        Ok(())
    }
    async fn claim(&self) -> Result<Option<Job>> {
        Ok(None)
    }
    async fn finish(&self, _job: &Job, _success: bool) -> Result<()> {
        Ok(())
    }
}

/// Granola, recording which webhooks were unregistered.
#[derive(Default)]
struct FakeGranola {
    unregistered: Mutex<Vec<Uuid>>,
}

#[async_trait]
impl Granola for FakeGranola {
    async fn register(
        &self,
        _connection: &Connection,
        _url: &str,
        _scope: Scope,
    ) -> Result<Registration> {
        Ok(Registration::ScopeRejected)
    }
    async fn unregister(&self, connection: &Connection) -> Result<()> {
        self.unregistered.lock().unwrap().push(connection.id);
        Ok(())
    }
    async fn meeting(
        &self,
        _connection: &Connection,
        _note: &NoteId,
    ) -> Result<Option<ImportedCall>> {
        Ok(None)
    }
}

struct AcceptAll;

impl DeliveryVerifier for AcceptAll {
    fn verify(&self, _secret: &SigningSecret, _delivery: &Delivery<'_>) -> bool {
        true
    }
}

struct NoCalls;

#[async_trait]
impl CallImportService for NoCalls {
    async fn ingest(&self, _call: ImportedCall) -> Result<Uuid> {
        Err(rootcause::report!("no calls in this test"))
    }
    async fn list(&self, _user: &MacroUserIdStr<'static>) -> Result<Vec<ImportedCallPreview>> {
        Ok(Vec::new())
    }
    async fn list_source_records(
        &self,
        _user: &MacroUserIdStr<'static>,
        _provider: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>> {
        Ok(Vec::new())
    }
    async fn read(
        &self,
        _user: &MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> Result<Option<CallEntityRecord>> {
        Ok(None)
    }
}

type FakeService =
    Service<FakeRepo, FakeGranola, ConnectedAccounts<connectors::Connectors>, AcceptAll>;

fn service(repo: FakeRepo, fake: &FakeConnectors) -> FakeService {
    Service {
        repo,
        granola: FakeGranola::default(),
        accounts: ConnectedAccounts(Arc::new(fake.build())),
        verifier: AcceptAll,
        calls: Arc::new(NoCalls),
        public_url: "https://macro.example.com".to_owned(),
    }
}

/// A holder whose connection could not be resolved is not a removed
/// connection: reconcile fails and retries, and stops nothing.
#[tokio::test]
async fn a_holder_that_cannot_be_resolved_keeps_its_sync() {
    let fake = FakeConnectors::new()
        .with_connections_unreachable(&user("a"))
        .with_connection(&user("a"), FakeConnection::app("granola"))
        .with_connection(&user("b"), FakeConnection::app("granola"));
    let service = service(FakeRepo::syncing(user("a")), &fake);

    assert!(service.reconcile().await.is_err());

    assert!(service.repo.stopped.lock().unwrap().is_empty());
    assert!(service.granola.unregistered.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_removed_connection_stops_its_sync_and_unregisters_its_webhook() {
    let fake = FakeConnectors::new().with_connection(&user("b"), FakeConnection::app("granola"));
    let repo = FakeRepo::syncing(user("a"));
    let id = repo.connections.lock().unwrap()[0].id;
    let service = service(repo, &fake);

    service.reconcile().await.unwrap();

    assert_eq!(*service.repo.stopped.lock().unwrap(), vec![id]);
    assert_eq!(*service.granola.unregistered.lock().unwrap(), vec![id]);
}
