use super::*;
use crate::domain::personas::Supervisor;
use std::sync::Mutex;
use std::time::Instant;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

struct Units(Mutex<Vec<UnitAction>>);
impl UnitController for Units {
    type Err = std::io::Error;
    async fn state(&self, _: &str) -> Result<UnitState, Self::Err> {
        Ok(UnitState::Stopped)
    }
    async fn apply(&self, _: &str, action: UnitAction) -> Result<(), Self::Err> {
        self.0.lock().unwrap().push(action);
        Ok(())
    }
}

#[tokio::test]
async fn a_real_health_endpoint_reports_degradation_and_preserves_turns_when_it_breaks() {
    let server = MockServer::start().await;
    let checked_at = Utc::now();
    Mock::given(method("GET"))
        .and(path("/health"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "status": "ok", "lastTurnAt": checked_at, "problems": []
        })))
        .expect(1)
        .mount(&server)
        .await;
    let units = Units(Mutex::new(Vec::new()));
    let mut supervisor = Supervisor::new(units, HttpHealth::new().unwrap());
    let config = Personas::from([(
        "persona".to_owned(),
        NonZeroU16::new(server.address().port()),
    )]);
    let now = Instant::now();
    let healthy = supervisor.snapshot(&config, now, checked_at).await;
    assert_eq!(
        healthy.get("persona"),
        Some(&PersonaHealth::Healthy {
            checked_at,
            last_turn_at: Some(checked_at)
        })
    );
    server.verify().await;
    server.reset().await;
    Mock::given(method("GET"))
        .and(path("/health"))
        .respond_with(ResponseTemplate::new(503).set_body_json(serde_json::json!({
            "status": "degraded", "problems": ["event stream disconnected"], "lastTurnAt": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    let degraded = supervisor
        .snapshot(&config, now + Duration::from_secs(15), checked_at)
        .await;
    assert_eq!(
        degraded.get("persona"),
        Some(&PersonaHealth::Unhealthy {
            checked_at,
            last_turn_at: Some(checked_at),
            last_error: "event stream disconnected".to_owned()
        })
    );
    server.verify().await;
    server.reset().await;
    Mock::given(method("GET"))
        .and(path("/health"))
        .respond_with(ResponseTemplate::new(200).set_body_string("private malformed response"))
        .expect(1)
        .mount(&server)
        .await;
    let invalid = supervisor
        .snapshot(&config, now + Duration::from_secs(30), checked_at)
        .await;
    assert_eq!(
        invalid.get("persona"),
        Some(&PersonaHealth::Unhealthy {
            checked_at,
            last_turn_at: Some(checked_at),
            last_error: "invalid brain health response".to_owned()
        })
    );
}

#[tokio::test]
async fn absent_and_oversized_endpoints_report_bounded_diagnostics() {
    let checked_at = Utc::now();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = NonZeroU16::new(listener.local_addr().unwrap().port()).unwrap();
    drop(listener);
    let health = HttpHealth::new().unwrap();
    assert!(matches!(
        health.probe(port, checked_at).await,
        PersonaHealth::Missing { .. }
    ));
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/health"))
        .respond_with(ResponseTemplate::new(200).set_body_string("x".repeat(MAX_HEALTH_BYTES + 1)))
        .mount(&server)
        .await;
    let report = health
        .probe(
            NonZeroU16::new(server.address().port()).unwrap(),
            checked_at,
        )
        .await;
    assert!(
        matches!(report, PersonaHealth::Unhealthy { last_error, .. } if last_error.len() < MAX_ERROR_CHARS)
    );
}

#[tokio::test]
async fn unknown_problem_text_is_never_persisted() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/health"))
        .respond_with(ResponseTemplate::new(503).set_body_json(serde_json::json!({
            "status": "degraded", "problems": ["private unexpected diagnostic"]
        })))
        .mount(&server)
        .await;
    let report = HttpHealth::new()
        .unwrap()
        .probe(
            NonZeroU16::new(server.address().port()).unwrap(),
            Utc::now(),
        )
        .await;
    assert!(matches!(report, PersonaHealth::Unhealthy { last_error, .. }
        if last_error == "invalid brain health response"));
}

#[tokio::test]
async fn privileged_command_output_is_bounded_and_errors_are_redacted() {
    let mut oversized = Command::new("sh");
    oversized.args(["-c", "head -c 65537 /dev/zero"]);
    assert!(matches!(
        bounded_command(oversized, COMMAND_TIMEOUT).await,
        Err(PersonaError::Discovery)
    ));
    let mut failed = Command::new("sh");
    failed.args(["-c", "echo private-diagnostic >&2; exit 1"]);
    assert!(matches!(
        bounded_command(failed, COMMAND_TIMEOUT).await,
        Err(PersonaError::Command)
    ));
}

#[tokio::test(start_paused = true)]
async fn pending_commands_time_out_without_sleeping_for_synchronization() {
    let mut command = Command::new("sh");
    command.args(["-c", "exec cat"]);
    // Keep stdin open so cat cannot exit before the virtual timeout.
    command.stdin(Stdio::piped());
    assert!(matches!(
        bounded_command(command, COMMAND_TIMEOUT).await,
        Err(PersonaError::Timeout)
    ));
}

#[test]
fn discovery_extracts_only_ports_without_executing_or_returning_secrets() {
    let root = tempfile::tempdir().unwrap();
    let marker = root.path().join("must-not-exist");
    std::fs::write(root.path().join("persona.env"), format!(
        "MACRO_REPO_TOKEN=\"test-repo-token\"\nBRAIN_HEALTH_PORT=\"7801\"\nIGNORED=\"$(touch {})\"\n", marker.display()
    )).unwrap();
    std::fs::write(
        root.path().join("broken.env"),
        "BRAIN_HEALTH_PORT=\"invalid\"\n",
    )
    .unwrap();
    std::fs::write(root.path().join("ignore.txt"), "BRAIN_HEALTH_PORT=1234\n").unwrap();
    std::fs::write(
        root.path().join("oversized.env"),
        "x".repeat(MAX_CONFIG_BYTES + 1),
    )
    .unwrap();
    let personas = read_personas(root.path()).unwrap();
    assert_eq!(
        personas,
        Personas::from([
            ("persona".to_owned(), NonZeroU16::new(7801)),
            ("broken".to_owned(), None),
            ("oversized".to_owned(), None)
        ])
    );
    assert!(
        !serde_json::to_string(&personas)
            .unwrap()
            .contains("test-repo-token")
    );
    assert!(!marker.exists());
    assert_eq!(health_port("BRAIN_HEALTH_PORT=0"), None);
    assert_eq!(health_port("BRAIN_HEALTH_PORT=65536"), None);
    assert!(unit_name("root").is_err());
    assert!(unit_name("macro").is_err());
    assert!(unit_name("--bad.service").is_err());
}

#[test]
fn unit_state_handles_absent_failed_and_automatically_restarting_units() {
    assert_eq!(
        parse_unit_state("ActiveState=inactive\nLoadState=not-found\n").unwrap(),
        UnitState::Missing
    );
    assert_eq!(
        parse_unit_state("LoadState=loaded\nActiveState=failed\n").unwrap(),
        UnitState::Failed
    );
    assert_eq!(
        parse_unit_state("LoadState=loaded\nActiveState=activating\n").unwrap(),
        UnitState::Transitioning
    );
    assert!(parse_unit_state("LoadState=masked\nActiveState=inactive\n").is_err());
}
