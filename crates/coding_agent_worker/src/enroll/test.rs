use std::cell::RefCell;

use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const ENROLLMENT_JSON: &str = r#"{
    "generation": 1,
    "computer_id": "00000000-0000-0000-0000-00000000000c",
    "pairing_id": "00000000-0000-0000-0000-00000000000a",
    "device_secret": "mhds_secret",
    "name": "Standard computer",
    "role": "person",
    "deployment": {
        "agent_harness_url": "http://10.200.0.1:41009/agent-harness/",
        "egress_url": "http://10.200.0.1:41027",
        "document_storage_url": "http://10.200.0.1:41009/dss",
        "app_url": "http://10.200.0.1:41000"
    }
}"#;

fn enrollment() -> Enrollment {
    serde_json::from_str(ENROLLMENT_JSON).expect("the literal is a valid enrollment")
}

#[test]
fn the_claim_retries_about_every_250_ms_with_jitter() {
    let mut delays = claim_retry_delays();
    let drawn: Vec<Duration> = (0..50).map(|_| delays.next_delay()).collect();
    assert!(
        drawn.iter().all(|delay| {
            (Duration::from_micros(187_500)..=Duration::from_micros(312_500)).contains(delay)
        }),
        "{drawn:?}"
    );
    // Jittered, so computers booting together do not claim in lockstep.
    assert!(drawn.iter().any(|delay| *delay != drawn[0]), "{drawn:?}");
}

#[derive(Default)]
struct FakeHost {
    calls: RefCell<Vec<String>>,
}

impl Host for FakeHost {
    fn chown(&self, path: &Path, owner: Ownership) -> rootcause::Result<()> {
        self.calls.borrow_mut().push(format!(
            "chown {} {}:{}",
            path.display(),
            owner.uid,
            owner.gid
        ));
        Ok(())
    }
}

#[test]
fn enrollment_sources_parse() {
    assert_eq!("mmds".parse(), Ok(EnrollmentSource::Mmds));
    assert_eq!(
        "file:/run/macro/enrollment.json".parse(),
        Ok(EnrollmentSource::File(PathBuf::from(
            "/run/macro/enrollment.json"
        )))
    );
    assert!("file:".parse::<EnrollmentSource>().is_err());
    assert!(
        "/run/macro/enrollment.json"
            .parse::<EnrollmentSource>()
            .is_err()
    );
}

#[test]
fn deployment_urls_come_from_the_typed_deployment() {
    assert_eq!(
        DeploymentUrls::from_deployment(&enrollment().deployment),
        DeploymentUrls {
            egress_url: "http://10.200.0.1:41027".to_owned(),
            api_url: "http://10.200.0.1:41009/agent-harness".to_owned(),
            storage_url: "http://10.200.0.1:41009/dss".to_owned(),
            web_url: "http://10.200.0.1:41000/app".to_owned(),
        }
    );
    // An enrollment from before typed deployments is refused, not guessed at.
    assert!(
        serde_json::from_str::<Enrollment>(
            &ENROLLMENT_JSON.replace("\"deployment\"", "\"service_url_overrides\"")
        )
        .is_err()
    );
}

#[tokio::test]
async fn enrollment_reads_from_a_file() {
    let directory = tempfile::tempdir().expect("temp dir");
    let paths = SystemPaths {
        root: directory.path().to_owned(),
        mmds: firecracker_host_api::mmds::ADDRESS.to_owned(),
    };
    let file = directory.path().join("enrollment.json");
    assert_eq!(
        read_enrollment(&EnrollmentSource::File(file.clone()), &paths)
            .await
            .unwrap(),
        None
    );
    std::fs::write(&file, ENROLLMENT_JSON).unwrap();
    assert_eq!(
        read_enrollment(&EnrollmentSource::File(file), &paths)
            .await
            .unwrap(),
        Some(enrollment())
    );
}

#[tokio::test]
async fn enrollment_reads_from_mmds_with_a_session_token() {
    let mmds = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/latest/api/token"))
        .and(header("X-metadata-token-ttl-seconds", "60"))
        .respond_with(ResponseTemplate::new(200).set_body_string("session-token"))
        .expect(2)
        .mount(&mmds)
        .await;
    // Without the token or `Accept: application/json`, MMDS refuses or
    // answers IMDS text; neither matches here, so the read finds nothing.
    Mock::given(method("GET"))
        .and(path("/macro/enrollment"))
        .and(header("X-metadata-token", "session-token"))
        .and(header("Accept", "application/json"))
        .respond_with(ResponseTemplate::new(200).set_body_string(ENROLLMENT_JSON))
        .up_to_n_times(1)
        .mount(&mmds)
        .await;
    let directory = tempfile::tempdir().expect("temp dir");
    let paths = SystemPaths {
        root: directory.path().to_owned(),
        mmds: mmds.uri(),
    };

    assert_eq!(
        read_enrollment(&EnrollmentSource::Mmds, &paths)
            .await
            .unwrap(),
        Some(enrollment())
    );
    // The control plane removed it once macrod connected: MMDS answers 404.
    assert_eq!(
        read_enrollment(&EnrollmentSource::Mmds, &paths)
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn an_mmds_error_is_not_a_missing_enrollment() {
    let mmds = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/latest/api/token"))
        .respond_with(ResponseTemplate::new(200).set_body_string("session-token"))
        .mount(&mmds)
        .await;
    Mock::given(method("GET"))
        .and(path("/macro/enrollment"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&mmds)
        .await;
    let directory = tempfile::tempdir().expect("temp dir");
    let paths = SystemPaths {
        root: directory.path().to_owned(),
        mmds: mmds.uri(),
    };

    let error = read_enrollment(&EnrollmentSource::Mmds, &paths)
        .await
        .unwrap_err();
    assert!(
        format!("{error:?}").contains("MMDS answered 503"),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_refused_mmds_token_is_an_error() {
    let mmds = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/latest/api/token"))
        .respond_with(ResponseTemplate::new(400))
        .mount(&mmds)
        .await;
    let directory = tempfile::tempdir().expect("temp dir");
    let paths = SystemPaths {
        root: directory.path().to_owned(),
        mmds: mmds.uri(),
    };

    let error = read_enrollment(&EnrollmentSource::Mmds, &paths)
        .await
        .unwrap_err();
    assert!(
        format!("{error:?}").contains("MMDS refused a session token"),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_retried_enrollment_keeps_its_credential_and_points_at_the_overrides() {
    let directory = tempfile::tempdir().expect("temp dir");
    let config = directory.path().join("macrod.toml");
    let workspace = directory.path().join("work");
    // What the first attempt left behind: a claimed credential, and a
    // storage URL nothing listens on, so a second claim would fail.
    std::fs::write(
        &config,
        r#"
[macro]
api_url = "http://127.0.0.1:9/agent-harness"
storage_url = "http://127.0.0.1:9/dss"

[harness]
command = "claude-code-acp"

[workspace]
path = "/"

[credentials]
harness_id = "00000000-0000-0000-0000-0000000000a1"
token = "mhns_claimed"
pairing_id = "00000000-0000-0000-0000-00000000000a"
"#,
    )
    .unwrap();
    let options = EnrollOptions {
        from: EnrollmentSource::File(directory.path().join("enrollment.json")),
        config: config.clone(),
        workspace: workspace.clone(),
        agent: "claude-code".to_owned(),
        root: directory.path().to_owned(),
    };
    let enrollment = enrollment();
    let urls = DeploymentUrls::from_deployment(&enrollment.deployment);

    write_config(&options, None, &urls).unwrap();
    ensure_credentials(&config, &enrollment).await.unwrap();

    let loaded = Config::load(&config).unwrap();
    assert_eq!(
        loaded.macro_api.api_url,
        "http://10.200.0.1:41009/agent-harness"
    );
    assert_eq!(
        loaded.macro_api.egress_url.as_deref(),
        Some("http://10.200.0.1:41027")
    );
    assert_eq!(loaded.macro_api.storage_url, "http://10.200.0.1:41009/dss");
    assert_eq!(loaded.macro_api.web_url, "http://10.200.0.1:41000/app");
    assert_eq!(loaded.workspace.path, workspace);
    assert!(workspace.is_dir());
    assert_eq!(
        loaded.credentials.map(|credentials| credentials.token),
        Some("mhns_claimed".to_owned())
    );
    assert_eq!(enrollment.pairing_id.as_uuid(), Uuid::from_u128(0xa));

    let host = FakeHost::default();
    own_like_parent(&config, &host).unwrap();
    let parent = std::fs::metadata(directory.path()).unwrap();
    assert_eq!(
        host.calls.into_inner(),
        [format!(
            "chown {} {}:{}",
            config.display(),
            parent.uid(),
            parent.gid()
        )]
    );
}

#[tokio::test]
async fn an_enrolled_computer_is_left_alone() {
    let directory = tempfile::tempdir().expect("temp dir");
    let marker = directory.path().join("var/lib/macrod/enrolled");
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, "done").unwrap();
    // The enrollment is never read again; only the existing config's uid is needed.
    let config = directory.path().join("macrod.toml");
    std::fs::write(&config, "existing config").unwrap();
    let host = FakeHost::default();
    run_enroll_with_host(
        EnrollOptions {
            from: EnrollmentSource::File(directory.path().join("missing.json")),
            config: config.clone(),
            workspace: directory.path().join("work"),
            agent: "claude-code".to_owned(),
            root: directory.path().to_owned(),
        },
        &host,
        |_| (),
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read_to_string(config).unwrap(), "existing config");
    assert!(host.calls.into_inner().is_empty());
}

#[tokio::test]
async fn the_claim_joins_the_setup_trace() {
    let parent = "00-11111111111111111111111111111111-2222222222222222-01";
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/dss/harness-pairings/00000000-0000-0000-0000-00000000000a/claim",
        ))
        .and(header("traceparent", parent))
        .respond_with(ResponseTemplate::new(202))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("temp dir");
    let config = directory.path().join("macrod.toml");
    std::fs::write(
        &config,
        format!(
            r#"
[macro]
api_url = "{uri}/agent-harness"
storage_url = "{uri}/dss"

[harness]
command = "claude-code-acp"

[workspace]
path = "/"
"#,
            uri = server.uri()
        ),
    )
    .unwrap();
    let client = crate::outbound::pairing::PairingClient::new(&Config::load(&config).unwrap())
        .with_trace_parent(Some(parent.to_owned()));
    let status = client
        .claim(enrollment().pairing_id, "mhds_secret")
        .await
        .unwrap();
    assert!(matches!(
        status,
        crate::outbound::pairing::ClaimStatus::Pending
    ));
    server.verify().await;
}

#[tokio::test]
async fn a_marker_as_new_as_the_enrollment_is_left_alone() {
    let directory = tempfile::tempdir().expect("temp dir");
    let marker = directory.path().join("var/lib/macrod/enrolled");
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, "00000000-0000-0000-0000-00000000000c\n1\n").unwrap();
    let source = directory.path().join("enrollment.json");
    std::fs::write(&source, ENROLLMENT_JSON).unwrap();
    let config = directory.path().join("macrod.toml");
    std::fs::write(&config, "existing config").unwrap();
    run_enroll_with_host(
        EnrollOptions {
            from: EnrollmentSource::File(source),
            config: config.clone(),
            workspace: directory.path().join("work"),
            agent: "claude-code".to_owned(),
            root: directory.path().to_owned(),
        },
        &FakeHost::default(),
        |_| (),
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read_to_string(config).unwrap(), "existing config");
}

/// A guest recreated on its old data disk: the marker and credential are
/// from generation 1, the enrollment is generation 2 with a new pairing.
#[tokio::test]
async fn a_newer_generation_enrolls_again_and_claims_its_pairing() {
    let server = MockServer::start().await;
    // Gone ends the claim at once; reaching it shows the new pairing was claimed.
    Mock::given(method("POST"))
        .and(path(
            "/dss/harness-pairings/00000000-0000-0000-0000-00000000000b/claim",
        ))
        .respond_with(ResponseTemplate::new(410))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("temp dir");
    let marker = directory.path().join("var/lib/macrod/enrolled");
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, "00000000-0000-0000-0000-00000000000c\n1\n").unwrap();
    let home_file = directory.path().join("work/notes.txt");
    std::fs::create_dir_all(home_file.parent().unwrap()).unwrap();
    std::fs::write(&home_file, "keep me").unwrap();
    let config = directory.path().join("macrod.toml");
    std::fs::write(
        &config,
        r#"
[macro]
api_url = "http://127.0.0.1:9/agent-harness"
storage_url = "http://127.0.0.1:9/dss"

[harness]
command = "claude-code-acp"

[workspace]
path = "/"

[credentials]
harness_id = "00000000-0000-0000-0000-0000000000a1"
token = "mhns_from_generation_one"
pairing_id = "00000000-0000-0000-0000-00000000000a"
"#,
    )
    .unwrap();
    let mut enrollment: serde_json::Value = serde_json::from_str(ENROLLMENT_JSON).unwrap();
    enrollment["generation"] = serde_json::json!(2);
    enrollment["pairing_id"] = serde_json::json!("00000000-0000-0000-0000-00000000000b");
    enrollment["deployment"]["document_storage_url"] =
        serde_json::json!(format!("{}/dss", server.uri()));
    let source = directory.path().join("enrollment.json");
    std::fs::write(&source, enrollment.to_string()).unwrap();

    let error = run_enroll_with_host(
        EnrollOptions {
            from: EnrollmentSource::File(source),
            config: config.clone(),
            workspace: directory.path().join("work"),
            agent: "claude-code".to_owned(),
            root: directory.path().to_owned(),
        },
        &FakeHost::default(),
        |_| (),
    )
    .await
    .unwrap_err();

    assert!(error.to_string().contains("cannot be claimed"), "{error}");
    server.verify().await;
    // The old enrollment is not marked done again, and the disk is untouched.
    assert_eq!(
        std::fs::read_to_string(&marker).unwrap(),
        "00000000-0000-0000-0000-00000000000c\n1\n"
    );
    assert_eq!(std::fs::read_to_string(home_file).unwrap(), "keep me");
}

/// The computer `ENROLLMENT_JSON` enrolls.
fn computer() -> hosted_runtimes::domain::ids::ComputerId {
    "00000000-0000-0000-0000-00000000000c".parse().unwrap()
}

#[tokio::test]
async fn an_enrollment_naming_an_intake_starts_telemetry_there_over_http() {
    let directory = tempfile::tempdir().expect("temp dir");
    let marker = directory.path().join("var/lib/macrod/enrolled");
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, "00000000-0000-0000-0000-00000000000c\n1\n").unwrap();
    let source = directory.path().join("enrollment.json");
    let mut enrollment: serde_json::Value = serde_json::from_str(ENROLLMENT_JSON).unwrap();
    enrollment["deployment"]["telemetry_url"] = "https://intake.example.com/i/otlp/".into();
    std::fs::write(&source, enrollment.to_string()).unwrap();
    let started = RefCell::new(None);

    run_enroll_with_host(
        EnrollOptions {
            from: EnrollmentSource::File(source),
            config: directory.path().join("macrod.toml"),
            workspace: directory.path().join("work"),
            agent: "claude-code".to_owned(),
            root: directory.path().to_owned(),
        },
        &FakeHost::default(),
        |exporter| *started.borrow_mut() = Some(exporter),
    )
    .await
    .unwrap();

    assert_eq!(
        started.into_inner(),
        Some(Some(crate::telemetry::Exporter::Http {
            endpoint: "https://intake.example.com/i/otlp".to_owned(),
            computer: Some(computer()),
        }))
    );
}

#[test]
fn the_telemetry_settings_are_written_for_the_service_and_removed_without_an_intake() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("var/lib/macrod/telemetry.env");

    write_telemetry_env(
        &path,
        Some(&crate::telemetry::Exporter::Http {
            endpoint: "https://intake.example.com/i/otlp".to_owned(),
            computer: Some(computer()),
        }),
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "OTEL_EXPORTER_OTLP_ENDPOINT=https://intake.example.com/i/otlp\n\
         OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf\n\
         OTEL_EXPORTER_OTLP_HEADERS=x-macro-computer-id=00000000-0000-0000-0000-00000000000c\n"
    );

    write_telemetry_env(&path, None).unwrap();
    assert!(!path.exists());
    write_telemetry_env(&path, None).unwrap();
}

/// A failed write of the telemetry settings leaves the computer unenrolled,
/// so the retry writes them instead of stopping at "already enrolled".
#[tokio::test]
async fn a_failed_telemetry_settings_write_is_retried() {
    let directory = tempfile::tempdir().expect("temp dir");
    let config = directory.path().join("macrod.toml");
    // Already claimed, so enrolling needs no server.
    std::fs::write(
        &config,
        r#"
[macro]
api_url = "http://127.0.0.1:9/agent-harness"
storage_url = "http://127.0.0.1:9/dss"

[harness]
command = "claude-code-acp"

[workspace]
path = "/"

[credentials]
harness_id = "00000000-0000-0000-0000-0000000000a1"
token = "mhns_claimed"
pairing_id = "00000000-0000-0000-0000-00000000000a"
"#,
    )
    .unwrap();
    let source = directory.path().join("enrollment.json");
    let mut enrollment: serde_json::Value = serde_json::from_str(ENROLLMENT_JSON).unwrap();
    enrollment["deployment"]["telemetry_url"] = "https://intake.example.com/i/otlp/".into();
    std::fs::write(&source, enrollment.to_string()).unwrap();
    let marker = directory.path().join("var/lib/macrod/enrolled");
    let settings = directory.path().join("var/lib/macrod/telemetry.env");
    // A directory where the settings go makes their write fail.
    std::fs::create_dir_all(&settings).unwrap();
    let options = || EnrollOptions {
        from: EnrollmentSource::File(source.clone()),
        config: config.clone(),
        workspace: directory.path().join("work"),
        agent: "claude-code".to_owned(),
        root: directory.path().to_owned(),
    };

    run_enroll_with_host(options(), &FakeHost::default(), |_| ())
        .await
        .unwrap_err();
    assert!(!marker.exists(), "enrollment was marked done");

    std::fs::remove_dir(&settings).unwrap();
    run_enroll_with_host(options(), &FakeHost::default(), |_| ())
        .await
        .unwrap();
    assert!(marker.exists());
    assert!(
        std::fs::read_to_string(&settings)
            .unwrap()
            .contains("https://intake.example.com/i/otlp")
    );
}
