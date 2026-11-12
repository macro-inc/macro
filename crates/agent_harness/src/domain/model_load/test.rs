use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    SessionConfigOption, SessionConfigSelectOption, SessionConfigValueId,
};

use super::*;
use chrono::TimeZone as _;

fn caller() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("models@example.com").unwrap()
}

fn options() -> Vec<SessionConfigOption> {
    vec![SessionConfigOption::select(
        "model",
        "Model",
        SessionConfigValueId::new("fast"),
        vec![SessionConfigSelectOption::new("fast", "Fast")],
    )]
}

struct Access(HarnessModelReach);

impl HarnessModelAccess for Access {
    async fn reach(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _harness: HarnessId,
    ) -> Result<HarnessModelReach, String> {
        Ok(self.0)
    }
}

#[derive(Default)]
struct Known(std::sync::Mutex<Option<KnownModels>>);

impl Known {
    fn holding(known: KnownModels) -> Self {
        Self(std::sync::Mutex::new(Some(known)))
    }
}

impl KnownMacrodModels for Known {
    async fn last_known(&self, _harness: HarnessId) -> Result<Option<KnownModels>, String> {
        Ok(self.0.lock().unwrap().clone())
    }

    async fn remember(
        &self,
        _harness: HarnessId,
        options: &[SessionConfigOption],
    ) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(KnownModels {
            options: options.to_vec(),
            observed_at: Utc::now(),
        });
        Ok(())
    }
}

struct Probe {
    callers: std::sync::Mutex<Vec<MacroUserIdStr<'static>>>,
    calls: AtomicUsize,
    result: fn() -> Result<RawModelProbe, ModelProbeError>,
}

impl Probe {
    fn new(result: fn() -> Result<RawModelProbe, ModelProbeError>) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            callers: std::sync::Mutex::new(Vec::new()),
            result,
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::Relaxed)
    }
}

impl InMemoryModelProbe for Probe {
    async fn probe(
        &self,
        caller: &MacroUserIdStr<'static>,
    ) -> Result<RawModelProbe, ModelProbeError> {
        self.callers.lock().unwrap().push(caller.clone());
        self.calls.fetch_add(1, Ordering::Relaxed);
        (self.result)()
    }
}

impl CursorModelProbe for Probe {
    async fn probe(
        &self,
        _caller: &MacroUserIdStr<'static>,
    ) -> Result<RawModelProbe, ModelProbeError> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        (self.result)()
    }
}

impl MacrodModelProbe for Probe {
    async fn probe(&self, _harness: HarnessId) -> Result<RawModelProbe, ModelProbeError> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        (self.result)()
    }
}

fn available() -> Result<RawModelProbe, ModelProbeError> {
    Ok(RawModelProbe::Options(options()))
}

fn unsupported() -> Result<RawModelProbe, ModelProbeError> {
    Ok(RawModelProbe::Unsupported)
}

struct HangingCursor;

impl CursorModelProbe for HangingCursor {
    async fn probe(
        &self,
        _caller: &MacroUserIdStr<'static>,
    ) -> Result<RawModelProbe, ModelProbeError> {
        std::future::pending().await
    }
}

#[tokio::test]
async fn macrod_authorizes_before_dispatch_and_projects_the_catalog() {
    let in_memory = Probe::new(unsupported);
    let cursor = Probe::new(unsupported);
    let macrod = Probe::new(available);
    let service = AgentModelsServiceImpl::new(
        Access(HarnessModelReach::Connected),
        in_memory,
        cursor,
        macrod,
        Known::default(),
        Duration::from_secs(1),
    );

    let result = service
        .load(
            caller(),
            LoadAgentModels {
                harness: ModelHarness::Macrod,
                harness_id: Some(HarnessId::TEST_A),
            },
        )
        .await
        .unwrap();

    assert_eq!(result.status, AgentModelsStatus::Available);
    assert_eq!(result.current_model.as_deref(), Some("fast"));
    assert_eq!(result.models[0].id, "fast");
    assert_eq!(service.in_memory.calls(), 0);
    assert_eq!(service.cursor.calls(), 0);
    assert_eq!(service.macrod.calls(), 1);
}

#[tokio::test]
async fn invisible_macrod_is_forbidden_without_probing() {
    let service = AgentModelsServiceImpl::new(
        Access(HarnessModelReach::Forbidden),
        Probe::new(unsupported),
        Probe::new(unsupported),
        Probe::new(available),
        Known::default(),
        Duration::from_secs(1),
    );

    let result = service
        .load(
            caller(),
            LoadAgentModels {
                harness: ModelHarness::Macrod,
                harness_id: Some(HarnessId::TEST_A),
            },
        )
        .await;

    assert!(matches!(result, Err(LoadAgentModelsError::Forbidden)));
    assert_eq!(service.macrod.calls(), 0);
}

#[tokio::test]
async fn unsupported_provider_returns_the_supported_response_shape() {
    let service = AgentModelsServiceImpl::new(
        Access(HarnessModelReach::Connected),
        Probe::new(unsupported),
        Probe::new(available),
        Probe::new(available),
        Known::default(),
        Duration::from_secs(1),
    );

    let result = service
        .load(
            caller(),
            LoadAgentModels {
                harness: ModelHarness::InMemory,
                harness_id: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(result, AgentModels::unsupported());
    assert_eq!(service.in_memory.calls(), 1);
    assert_eq!(*service.in_memory.callers.lock().unwrap(), vec![caller()]);
    assert_eq!(service.cursor.calls(), 0);
}

#[tokio::test]
async fn cursor_probe_obeys_the_service_timeout() {
    let service = AgentModelsServiceImpl::new(
        Access(HarnessModelReach::Connected),
        Probe::new(unsupported),
        HangingCursor,
        Probe::new(unsupported),
        Known::default(),
        Duration::from_millis(1),
    );

    let result = service
        .load(
            caller(),
            LoadAgentModels {
                harness: ModelHarness::Cursor,
                harness_id: None,
            },
        )
        .await;

    assert!(matches!(result, Err(LoadAgentModelsError::Timeout)));
}

fn macrod_request() -> LoadAgentModels {
    LoadAgentModels {
        harness: ModelHarness::Macrod,
        harness_id: Some(HarnessId::TEST_A),
    }
}

#[tokio::test]
async fn a_live_macrod_catalog_is_remembered_and_not_marked_cached() {
    let service = AgentModelsServiceImpl::new(
        Access(HarnessModelReach::Connected),
        Probe::new(unsupported),
        Probe::new(unsupported),
        Probe::new(available),
        Known::default(),
        Duration::from_secs(1),
    );

    let result = service.load(caller(), macrod_request()).await.unwrap();

    assert_eq!(result.cached_at, None);
    assert_eq!(
        service
            .known
            .0
            .lock()
            .unwrap()
            .as_ref()
            .map(|known| known.options.clone()),
        Some(options())
    );
}

#[tokio::test]
async fn a_powered_off_computer_serves_its_last_catalog_without_probing() {
    let observed_at = Utc.with_ymd_and_hms(2026, 11, 9, 12, 0, 0).unwrap();
    let service = AgentModelsServiceImpl::new(
        Access(HarnessModelReach::Disconnected),
        Probe::new(unsupported),
        Probe::new(unsupported),
        Probe::new(available),
        Known::holding(KnownModels {
            options: options(),
            observed_at,
        }),
        Duration::from_secs(1),
    );

    let result = service.load(caller(), macrod_request()).await.unwrap();

    assert_eq!(result.status, AgentModelsStatus::Available);
    assert_eq!(result.models[0].id, "fast");
    assert_eq!(result.cached_at, Some(observed_at));
    assert_eq!(service.macrod.calls(), 0);
}

#[tokio::test]
async fn a_failed_probe_falls_back_to_the_last_catalog() {
    let observed_at = Utc.with_ymd_and_hms(2026, 11, 9, 12, 0, 0).unwrap();
    let service = AgentModelsServiceImpl::new(
        Access(HarnessModelReach::Connected),
        Probe::new(unsupported),
        Probe::new(unsupported),
        Probe::new(|| Err(ModelProbeError::Failed("socket closed".to_owned()))),
        Known::holding(KnownModels {
            options: options(),
            observed_at,
        }),
        Duration::from_secs(1),
    );

    let result = service.load(caller(), macrod_request()).await.unwrap();

    assert_eq!(result.cached_at, Some(observed_at));
}

#[tokio::test]
async fn a_disconnected_runtime_never_seen_is_still_disconnected() {
    let service = AgentModelsServiceImpl::new(
        Access(HarnessModelReach::Disconnected),
        Probe::new(unsupported),
        Probe::new(unsupported),
        Probe::new(available),
        Known::default(),
        Duration::from_secs(1),
    );

    let result = service.load(caller(), macrod_request()).await;

    assert!(matches!(result, Err(LoadAgentModelsError::Disconnected)));
}
