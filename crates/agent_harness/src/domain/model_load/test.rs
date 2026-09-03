use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    SessionConfigOption, SessionConfigSelectOption, SessionConfigValueId,
};

use super::*;

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

struct Access(bool);

impl HarnessModelAccess for Access {
    async fn can_use(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _harness: HarnessId,
    ) -> Result<bool, String> {
        Ok(self.0)
    }
}

struct Probe {
    calls: AtomicUsize,
    result: fn() -> Result<RawModelProbe, ModelProbeError>,
}

impl Probe {
    fn new(result: fn() -> Result<RawModelProbe, ModelProbeError>) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            result,
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::Relaxed)
    }
}

impl InMemoryModelProbe for Probe {
    async fn probe(&self) -> Result<RawModelProbe, ModelProbeError> {
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

#[tokio::test]
async fn macrod_authorizes_before_dispatch_and_projects_the_catalog() {
    let in_memory = Probe::new(unsupported);
    let cursor = Probe::new(unsupported);
    let macrod = Probe::new(available);
    let service = AgentModelsServiceImpl::new(
        Access(true),
        in_memory,
        cursor,
        macrod,
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
        Access(false),
        Probe::new(unsupported),
        Probe::new(unsupported),
        Probe::new(available),
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
        Access(true),
        Probe::new(unsupported),
        Probe::new(available),
        Probe::new(available),
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
    assert_eq!(service.cursor.calls(), 0);
}
