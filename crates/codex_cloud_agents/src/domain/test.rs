use super::*;
use std::collections::VecDeque;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

fn credentials(account: &str, expiry: u64) -> Credentials {
    Credentials {
        version: 1,
        access_token: Secret::new("test-access".to_owned()).unwrap(),
        refresh_token: Secret::new("test-refresh".to_owned()).unwrap(),
        expires_at: expiry,
        account_id: account.to_owned(),
    }
}

#[derive(Default)]
struct Store {
    value: Mutex<Option<Credentials>>,
    saves: AtomicUsize,
}
impl CredentialStore for Store {
    fn load(&self) -> Result<Option<Credentials>, rootcause::Report> {
        Ok(self
            .value
            .lock()
            .unwrap()
            .as_ref()
            .map(|value| serde_json::from_value(serde_json::to_value(value).unwrap()).unwrap()))
    }
    fn save(&self, value: &Credentials) -> Result<(), rootcause::Report> {
        *self.value.lock().unwrap() =
            Some(serde_json::from_value(serde_json::to_value(value).unwrap()).unwrap());
        self.saves.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn clear(&self) -> Result<(), rootcause::Report> {
        *self.value.lock().unwrap() = None;
        Ok(())
    }
}

struct Provider {
    polls: Mutex<VecDeque<LoginPoll>>,
    poll_count: AtomicUsize,
    refresh_account: &'static str,
    refresh_count: AtomicUsize,
    reads: AtomicUsize,
    creates: AtomicUsize,
    environment_visible: bool,
}
impl Provider {
    fn new(polls: Vec<LoginPoll>) -> Self {
        Self {
            polls: Mutex::new(polls.into()),
            poll_count: AtomicUsize::new(0),
            refresh_account: "account-a",
            refresh_count: AtomicUsize::new(0),
            reads: AtomicUsize::new(0),
            creates: AtomicUsize::new(0),
            environment_visible: false,
        }
    }
}
fn login() -> DeviceLogin {
    DeviceLogin {
        verification_url: "https://example.test/device".to_owned(),
        user_code: "ABCD".to_owned(),
        device_auth_id: Secret::new("device".to_owned()).unwrap(),
        interval: Duration::from_secs(5),
        timeout: Duration::from_secs(11),
    }
}
impl OAuth for Provider {
    async fn begin(&self) -> Result<DeviceLogin, rootcause::Report> {
        Ok(login())
    }
    async fn poll(&self, _: &DeviceLogin) -> Result<LoginPoll, rootcause::Report> {
        self.poll_count.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .polls
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(LoginPoll::Pending))
    }
    async fn refresh(&self, _: &Credentials) -> Result<Credentials, rootcause::Report> {
        self.refresh_count.fetch_add(1, Ordering::SeqCst);
        tokio::task::yield_now().await;
        Ok(credentials(self.refresh_account, 1000))
    }
    async fn environments(&self, _: &Credentials) -> Result<Vec<Environment>, rootcause::Report> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(if self.environment_visible {
            vec![Environment {
                repositories: vec![],
                id: "env-test".to_owned(),
                label: None,
            }]
        } else {
            vec![]
        })
    }
}

impl cloud::CloudTasks for Provider {
    async fn create(
        &self,
        _: &Credentials,
        _: &cloud::Launch,
    ) -> Result<cloud::CreatedTask, rootcause::Report> {
        self.creates.fetch_add(1, Ordering::SeqCst);
        Err(rootcause::report!("submission outcome unknown"))
    }
    async fn snapshot(
        &self,
        _: &Credentials,
        _: &cloud::CloudId,
    ) -> Result<cloud::TaskSnapshot, rootcause::Report> {
        Err(rootcause::report!("no fixture"))
    }
}

#[tokio::test]
async fn invisible_environment_blocks_launch_and_ambiguous_submission_is_not_retried() {
    let request = cloud::Launch {
        environment: cloud::CloudId::new("env-test".to_owned()).unwrap(),
        branch: "main".to_owned(),
        prompt: "Say hello".to_owned(),
    };
    for visible in [false, true] {
        let store = Store::default();
        store.save(&credentials("account-a", 1000)).unwrap();
        let mut provider = Provider::new(vec![]);
        provider.environment_visible = visible;
        let probe = Probe::new(provider, store);
        assert!(probe.launch(&request, 1).await.is_err());
        assert_eq!(
            probe.provider.creates.load(Ordering::SeqCst),
            usize::from(visible)
        );
    }
}

#[test]
fn task_paths_and_launch_inputs_are_validated() {
    for id in [
        "",
        "../task",
        "task?x=1",
        "task/other",
        "task%2fother",
        "task\n",
    ] {
        assert!(cloud::CloudId::new(id.to_owned()).is_err());
    }
    let mut request = cloud::Launch {
        environment: cloud::CloudId::new("env-test".to_owned()).unwrap(),
        branch: "main".to_owned(),
        prompt: " ".to_owned(),
    };
    assert!(request.validate().is_err());
    request.prompt = "x".repeat(64 * 1024 + 1);
    assert!(request.validate().is_err());
}

#[tokio::test(start_paused = true)]
async fn polls_at_interval_and_saves_only_after_completion() {
    let probe = Probe::new(
        Provider::new(vec![
            LoginPoll::Pending,
            LoginPoll::Complete(credentials("account-a", 1000)),
        ]),
        Store::default(),
    );
    let start = tokio::time::Instant::now();
    probe.finish_login(&login()).await.unwrap();
    assert_eq!(start.elapsed(), Duration::from_secs(5));
    assert_eq!(probe.store.saves.load(Ordering::SeqCst), 1);
    assert_eq!(probe.status().unwrap().unwrap().account_id, "account-a");
}

#[tokio::test(start_paused = true)]
async fn expired_login_stops_polling_without_saving() {
    let probe = Probe::new(Provider::new(vec![]), Store::default());
    assert!(probe.finish_login(&login()).await.is_err());
    assert_eq!(probe.provider.poll_count.load(Ordering::SeqCst), 3);
    assert_eq!(probe.store.saves.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn dropped_login_cannot_save_late_credentials() {
    let probe = Probe::new(
        Provider::new(vec![
            LoginPoll::Pending,
            LoginPoll::Complete(credentials("account-a", 1000)),
        ]),
        Store::default(),
    );
    assert!(
        tokio::time::timeout(Duration::from_secs(1), probe.finish_login(&login()))
            .await
            .is_err()
    );
    tokio::time::advance(Duration::from_secs(20)).await;
    assert_eq!(probe.store.saves.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn refresh_is_saved_before_cloud_read() {
    let store = Store::default();
    store.save(&credentials("account-a", 100)).unwrap();
    let probe = Probe::new(Provider::new(vec![]), store);
    probe.environments(100).await.unwrap();
    assert_eq!(probe.provider.refresh_count.load(Ordering::SeqCst), 1);
    assert_eq!(probe.status().unwrap().unwrap().expires_at, 1000);
    probe.environments(100).await.unwrap();
    assert_eq!(probe.provider.refresh_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn refresh_cannot_switch_account_or_use_it_for_a_read() {
    let store = Store::default();
    store.save(&credentials("account-a", 100)).unwrap();
    let mut provider = Provider::new(vec![]);
    provider.refresh_account = "account-b";
    let probe = Probe::new(provider, store);
    assert!(probe.environments(100).await.is_err());
    assert_eq!(probe.status().unwrap().unwrap().account_id, "account-a");
    assert_eq!(probe.provider.reads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn connection_requires_explicit_logout_before_replacement() {
    let store = Store::default();
    store.save(&credentials("account-a", 1000)).unwrap();
    let probe = Probe::new(Provider::new(vec![]), store);
    assert!(probe.begin_login().await.is_err());
    probe.logout().unwrap();
    assert!(probe.begin_login().await.is_ok());
    assert!(probe.environments(1).await.is_err());
}

#[test]
fn rejects_header_injection_and_invalid_state_without_echoing_secrets() {
    let mut value = credentials("account-a", 1);
    value.account_id = "account\r\nInjected: secret-marker".to_owned();
    let error = value.validate().unwrap_err().to_string();
    assert!(!error.contains("secret-marker"));
    value.account_id = "account-a".to_owned();
    value.version = 2;
    assert!(value.validate().is_err());
}

#[tokio::test]
async fn concurrent_credential_reads_rotate_refresh_token_once() {
    let store = Store::default();
    store.save(&credentials("account-a", 100)).unwrap();
    let probe = Probe::new(Provider::new(vec![]), store);
    let (first, second) = tokio::join!(probe.environments(100), probe.environments(100));
    first.unwrap();
    second.unwrap();
    assert_eq!(probe.provider.refresh_count.load(Ordering::SeqCst), 1);
    assert_eq!(probe.provider.reads.load(Ordering::SeqCst), 2);
}

#[test]
fn validates_remote_branch_before_launch() {
    for branch in [
        "",
        "bad ref",
        "main..other",
        "main@{1}",
        "-main",
        "a.lock",
        "a/.hidden",
        "a/",
        "a\\b",
        "a?b",
    ] {
        assert!(cloud::validate_branch(branch).is_err(), "{branch}");
    }
    for branch in ["main", "feature/work", "refs/heads/main", "release-1.2"] {
        assert!(cloud::validate_branch(branch).is_ok(), "{branch}");
    }
}
