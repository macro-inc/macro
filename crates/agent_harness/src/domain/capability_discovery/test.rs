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

impl HarnessCapabilityAccess for Access {
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
    result: fn() -> Result<RawCapabilityProbe, CapabilityProbeError>,
}

impl Probe {
    fn new(result: fn() -> Result<RawCapabilityProbe, CapabilityProbeError>) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            result,
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::Relaxed)
    }
}

impl InMemoryCapabilityProbe for Probe {
    async fn probe(&self) -> Result<RawCapabilityProbe, CapabilityProbeError> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        (self.result)()
    }
}

impl CursorCapabilityProbe for Probe {
    async fn probe(
        &self,
        _caller: &MacroUserIdStr<'static>,
    ) -> Result<RawCapabilityProbe, CapabilityProbeError> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        (self.result)()
    }
}

impl MacrodCapabilityProbe for Probe {
    async fn probe(&self, _harness: HarnessId) -> Result<RawCapabilityProbe, CapabilityProbeError> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        (self.result)()
    }
}

fn available() -> Result<RawCapabilityProbe, CapabilityProbeError> {
    Ok(RawCapabilityProbe::Options(options()))
}

fn unsupported() -> Result<RawCapabilityProbe, CapabilityProbeError> {
    Ok(RawCapabilityProbe::Unsupported)
}

struct HangingCursor;

impl CursorCapabilityProbe for HangingCursor {
    async fn probe(
        &self,
        _caller: &MacroUserIdStr<'static>,
    ) -> Result<RawCapabilityProbe, CapabilityProbeError> {
        std::future::pending().await
    }
}

#[tokio::test]
async fn macrod_authorizes_before_dispatch_and_projects_the_catalog() {
    let in_memory = Probe::new(unsupported);
    let cursor = Probe::new(unsupported);
    let macrod = Probe::new(available);
    let service = AgentCapabilitiesServiceImpl::new(
        Access(true),
        in_memory,
        cursor,
        macrod,
        Duration::from_secs(1),
    );

    let result = service
        .load(
            caller(),
            DiscoverAgentCapabilities {
                harness: CapabilityHarness::Macrod,
                harness_id: Some(HarnessId::TEST_A),
            },
        )
        .await
        .unwrap();

    assert_eq!(result.config_options[0].id, "model");
    assert_eq!(service.in_memory.calls(), 0);
    assert_eq!(service.cursor.calls(), 0);
    assert_eq!(service.macrod.calls(), 1);
}

#[tokio::test]
async fn invisible_macrod_is_forbidden_without_probing() {
    let service = AgentCapabilitiesServiceImpl::new(
        Access(false),
        Probe::new(unsupported),
        Probe::new(unsupported),
        Probe::new(available),
        Duration::from_secs(1),
    );

    let result = service
        .load(
            caller(),
            DiscoverAgentCapabilities {
                harness: CapabilityHarness::Macrod,
                harness_id: Some(HarnessId::TEST_A),
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(DiscoverAgentCapabilitiesError::Forbidden)
    ));
    assert_eq!(service.macrod.calls(), 0);
}

#[tokio::test]
async fn unsupported_provider_returns_the_supported_response_shape() {
    let service = AgentCapabilitiesServiceImpl::new(
        Access(true),
        Probe::new(unsupported),
        Probe::new(available),
        Probe::new(available),
        Duration::from_secs(1),
    );

    let result = service
        .load(
            caller(),
            DiscoverAgentCapabilities {
                harness: CapabilityHarness::InMemory,
                harness_id: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(result, AgentCapabilities::unsupported());
    assert_eq!(service.in_memory.calls(), 1);
    assert_eq!(service.cursor.calls(), 0);
}

#[tokio::test]
async fn cursor_probe_obeys_the_service_timeout() {
    let service = AgentCapabilitiesServiceImpl::new(
        Access(true),
        Probe::new(unsupported),
        HangingCursor,
        Probe::new(unsupported),
        Duration::from_millis(1),
    );

    let result = service
        .load(
            caller(),
            DiscoverAgentCapabilities {
                harness: CapabilityHarness::Cursor,
                harness_id: None,
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(DiscoverAgentCapabilitiesError::Timeout)
    ));
}
