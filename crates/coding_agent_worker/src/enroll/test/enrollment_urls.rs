//! Actual issuance, transport and worker files consumed by the real brain loader.
use super::*;
use hosted_runtimes::domain::{
    ids::ComputerId,
    lifecycle::{ComputerState, HostId},
    models::{Computer, ComputerName},
    persona_credentials::{EnrollmentGeneration, PersonaCredentialError, PersonaEnv},
    ports::PersonaCredentialSource,
    size::current_catalog,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};
use team_agents::domain::{
    enrollment::{
        EnrollmentAccounts, EnrollmentAgent, EnrollmentComputers, EnrollmentContext,
        EnrollmentEnvironment,
    },
    models::{AgentApiKey, AgentRepo, PersonaSeed, RepoToken, TeamAgentError},
    ports::{AgentApiKeys, AgentRepos},
    service::TeamAgentServiceImpl,
};

struct Accounts;
impl EnrollmentAccounts for Accounts {
    type Guard = ();
    async fn enrollment_context(
        &self,
        _computer: ComputerId,
        candidate: Option<&MacroUserIdStr<'_>>,
        team: uuid::Uuid,
    ) -> Result<EnrollmentContext<()>, PersonaCredentialError> {
        Ok(EnrollmentContext {
            guard: (),
            agent: Some(EnrollmentAgent {
                user_id: candidate.unwrap().clone().into_owned(),
                team_id: team,
                is_agent: true,
                seed: PersonaSeed {
                    name: "Agent Example".into(),
                    job_description: "Maintain the workspace".into(),
                    personality: "Direct".into(),
                    voice: None,
                    creator_id: None,
                },
            }),
        })
    }
    async fn finish_enrollment(
        &self,
        _guard: (),
        _computer: ComputerId,
        _agent: &MacroUserIdStr<'_>,
    ) -> Result<(), PersonaCredentialError> {
        Ok(())
    }
}
struct Computers {
    computer: Computer,
    generation: Arc<AtomicU32>,
}
impl EnrollmentComputers for Computers {
    async fn enrollment_computer(
        &self,
        id: ComputerId,
    ) -> Result<Computer, PersonaCredentialError> {
        assert_eq!(id, self.computer.id);
        let mut computer = self.computer.clone();
        computer.enrollment_generation =
            EnrollmentGeneration::new(self.generation.load(Ordering::SeqCst));
        Ok(computer)
    }
}
struct Keys(Arc<AtomicU32>);
impl AgentApiKeys for Keys {
    async fn mint(&self, _agent: &MacroUserIdStr<'_>) -> Result<AgentApiKey, TeamAgentError> {
        Ok(AgentApiKey::parse(format!("mak_{:064x}", self.0.load(Ordering::SeqCst))).unwrap())
    }
}
struct Repos(Arc<AtomicU32>);
impl AgentRepos for Repos {
    async fn voice(
        &self,
        _agent: &MacroUserIdStr<'_>,
        _team: uuid::Uuid,
    ) -> Result<team_agents::domain::voice::AgentVoice, TeamAgentError> {
        unreachable!("issuance does not read voice")
    }
    async fn set_voice(
        &self,
        _agent: &MacroUserIdStr<'_>,
        _team: uuid::Uuid,
        _voice: team_agents::domain::voice::AgentVoice,
    ) -> Result<(), TeamAgentError> {
        unreachable!("issuance does not set voice")
    }
    async fn create(
        &self,
        _agent: &MacroUserIdStr<'_>,
        _team: uuid::Uuid,
        _seed: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        Ok(AgentRepo {
            url: format!(
                "https://git.example.com/g{}/repo",
                self.0.load(Ordering::SeqCst)
            ),
            token: RepoToken::parse(format!("mrt_{:064x}", self.0.load(Ordering::SeqCst))).unwrap(),
        })
    }
    async fn ensure(
        &self,
        _agent: &MacroUserIdStr<'_>,
        _team: uuid::Uuid,
        _seed: &PersonaSeed,
        _token: &RepoToken,
    ) -> Result<(), TeamAgentError> {
        unreachable!("issuance rotates instead of replaying")
    }
    async fn delete(&self, _agent: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        unreachable!("issuance does not delete")
    }
}
struct Addresses(Arc<AtomicU32>);
impl EnrollmentEnvironment for Addresses {
    fn environment(&self) -> Result<PersonaEnv, PersonaCredentialError> {
        let generation = self.0.load(Ordering::SeqCst);
        PersonaEnv::new(
            [
                (
                    "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
                    format!("https://storage.example.com/g{generation}"),
                ),
                (
                    "OVERRIDE_AUTH_SERVICE_URL",
                    format!("https://auth.example.com/g{generation}"),
                ),
                (
                    "OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL",
                    format!("https://cognition.example.com/g{generation}"),
                ),
                (
                    "OVERRIDE_AGENT_HARNESS_SERVICE_URL",
                    format!("https://harness.example.com/g{generation}"),
                ),
                (
                    "OVERRIDE_SCHEDULED_ACTION_SERVICE_URL",
                    format!("https://scheduled.example.com/g{generation}"),
                ),
                (
                    "OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL",
                    format!("wss://connection.example.com/g{generation}"),
                ),
                (
                    "OVERRIDE_MCP_SERVICE_URL",
                    format!("https://mcp.example.com/g{generation}"),
                ),
                ("MACRO_GATEWAY", "https://gateway.example.com".into()),
                (
                    "ANTHROPIC_BASE_URL",
                    "https://egress.example.com/brain/anthropic".into(),
                ),
            ]
            .into_iter()
            .map(|(key, value)| (PersonaConfigKey::parse(key).unwrap(), value))
            .collect(),
        )
    }
}

#[tokio::test]
async fn create_and_recreate_enrollment_private_files_pass_the_real_brain_config() {
    use chrono::{TimeZone, Utc};
    let root = tempfile::tempdir().unwrap();
    let paths = SystemPaths {
        root: root.path().to_owned(),
    };
    let generation = Arc::new(AtomicU32::new(1));
    let persona:Persona=serde_json::from_value(serde_json::json!({
        "name":"Agent Example","os_user":"agent-example",
        "extra_service":{"unit_name":"brain@agent-example","exec":"/opt/macro/brain run","env":{}},
        "config":{"MACRO_AGENT_USER_ID":"macro|agent@example.com","BRAIN_WORKSPACE":"/home/agent-example/workspace","BRAIN_HEALTH_PORT":"7801"}
    })).unwrap();
    let durable = serde_json::to_value(&persona).unwrap();
    let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
    let catalog = current_catalog();
    let spec = &catalog[0];
    let computer = Computer {
        id: ComputerId::new_from_uuid(uuid::Uuid::from_u128(10)),
        team_id: uuid::Uuid::from_u128(20),
        name: ComputerName::try_new("Agent Example").unwrap(),
        size: spec.size,
        resources: spec.resources,
        catalog_entry: spec.id.clone(),
        price_id: None,
        state: ComputerState::reserved(HostId::new(uuid::Uuid::from_u128(30)), now),
        harness_id: None,
        persona: Some(persona.clone()),
        enrollment_generation: EnrollmentGeneration::new(1),
        created_by: MacroUserIdStr::parse_from_str("macro|admin@example.com")
            .unwrap()
            .into_owned(),
        created_at: now,
        enrolled_at: None,
    };
    let service = TeamAgentServiceImpl::new(
        Accounts,
        (),
        Keys(generation.clone()),
        (),
        Computers {
            computer: computer.clone(),
            generation: generation.clone(),
        },
        Repos(generation.clone()),
        None::<()>,
        String::new(),
    )
    .with_enrollment_environment(Addresses(generation.clone()));
    // Resolve the interpreter before clearing the child environment. No ambient
    // service URL or credential can satisfy loadConfig in either child.
    let node = std::process::Command::new("node")
        .args(["-p", "process.execPath"])
        .output()
        .unwrap();
    assert!(node.status.success());
    let node = String::from_utf8(node.stdout).unwrap();
    let node = node.trim();
    let config = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/brain/src/config.ts")
        .canonicalize()
        .unwrap();
    for value in [1, 2] {
        generation.store(value, Ordering::SeqCst);
        let material = service
            .issue(computer.id, EnrollmentGeneration::new(value))
            .await
            .unwrap();
        let enrollment = Enrollment {
            computer_id: computer.id,
            generation: EnrollmentGeneration::new(value),
            pairing_id: "00000000-0000-0000-0000-000000000028".parse().unwrap(),
            device_secret: hosted_runtimes::domain::enrollment::DeviceSecret::new(
                "mhds_fixture".into(),
            ),
            name: computer.name.clone(),
            service_url_overrides: Default::default(),
            persona: Some(persona.clone()),
            persona_enrollment: material,
        };
        // Exercise the real transport decoder before the real worker renderer.
        let received: Enrollment =
            serde_json::from_value(serde_json::to_value(&enrollment).unwrap()).unwrap();
        let files = PersonaFiles::render(
            received.persona.as_ref().unwrap(),
            &received.persona_enrollment,
            &paths,
        )
        .unwrap();
        files.install(&FakeHost::default()).unwrap();
        assert_eq!(
            std::fs::metadata(&files.env_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(serde_json::to_value(&persona).unwrap(), durable);
        assert_eq!(serde_json::to_value(&computer.persona).unwrap(), durable);
        assert_eq!(durable["config"].as_object().unwrap().len(), 3);
        let output = std::process::Command::new(node)
            .env_clear()
            .env("BRAIN_EXECUTABLE", "/opt/macro/brain")
            .arg("--env-file")
            .arg(&files.env_path)
            .args([
                "--input-type=module",
                "--eval",
                include_str!("brain_config.mjs"),
            ])
            .arg(&config)
            .arg(value.to_string())
            .arg(&files.env_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "real brain loader rejected enrollment: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
