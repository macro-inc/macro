use std::cell::RefCell;

use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use uuid::Uuid;

use super::*;

const ENROLLMENT_JSON: &str = r#"{
    "generation": 1,
    "computer_id": "00000000-0000-0000-0000-00000000000c",
    "pairing_id": "00000000-0000-0000-0000-00000000000a",
    "device_secret": "mhds_secret",
    "name": "Standard computer",
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
    assert_eq!("incus".parse(), Ok(EnrollmentSource::Incus));
    assert_eq!(
        "file:/run/macro/enrollment.json".parse(),
        Ok(EnrollmentSource::File(PathBuf::from(
            "/run/macro/enrollment.json"
        )))
    );
    assert!("file:".parse::<EnrollmentSource>().is_err());
    assert!("/dev/incus".parse::<EnrollmentSource>().is_err());
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
async fn enrollment_reads_from_a_file_and_the_incus_guest_api() {
    let directory = tempfile::tempdir().expect("temp dir");
    let file = directory.path().join("enrollment.json");
    std::fs::write(&file, ENROLLMENT_JSON).unwrap();
    let paths = SystemPaths {
        root: directory.path().to_owned(),
    };
    assert_eq!(
        read_enrollment(&EnrollmentSource::File(file), &paths)
            .await
            .unwrap(),
        Some(enrollment())
    );

    let socket = paths.at(INCUS_SOCKET);
    std::fs::create_dir_all(socket.parent().unwrap()).unwrap();
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut buffer).await.unwrap();
            request.extend_from_slice(&buffer[..read]);
        }
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{ENROLLMENT_JSON}",
            ENROLLMENT_JSON.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });
    assert_eq!(
        read_enrollment(&EnrollmentSource::Incus, &paths)
            .await
            .unwrap(),
        Some(enrollment())
    );
    let request = server.await.unwrap();
    assert!(
        request.starts_with("GET /1.0/config/user.macro.enrollment HTTP/1.1\r\n"),
        "{request}"
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
        from: EnrollmentSource::Incus,
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
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read_to_string(config).unwrap(), "existing config");
    assert!(host.calls.into_inner().is_empty());
}

#[tokio::test]
async fn the_claim_joins_the_setup_trace() {
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{header, method, path},
    };
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
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read_to_string(config).unwrap(), "existing config");
}

/// A guest recreated on its old data disk: the marker and credential are
/// from generation 1, the enrollment is generation 2 with a new pairing.
#[tokio::test]
async fn a_newer_generation_enrolls_again_and_claims_its_pairing() {
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };
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

#[test]
fn an_agent_computer_gets_its_brains_environment_file() {
    let directory = tempfile::tempdir().expect("temp dir");
    let config = directory.path().join("macrod.toml");
    let env_path = directory.path().join("var/lib/macrod/agent.env");
    let agent: hosted_runtimes::domain::agent::AgentEnrollment = serde_json::from_str(
        r#"{
            "agent_user_id": "macro|sam-rivera-abc123@agents.macro.invalid",
            "env": {
                "MACRO_API_KEY": "mak_secret",
                "MACRO_REPO_URL": "http://agent-git:8111/macro%7Csam.git",
                "ODD_VALUE": "a \"quoted\" \\ value"
            }
        }"#,
    )
    .unwrap();
    let host = FakeHost::default();

    write_agent_env(&env_path, Some(&agent), &config, &host).unwrap();

    assert_eq!(
        std::fs::read_to_string(&env_path).unwrap(),
        concat!(
            "MACRO_API_KEY=\"mak_secret\"\n",
            "MACRO_REPO_URL=\"http://agent-git:8111/macro%7Csam.git\"\n",
            "ODD_VALUE=\"a \\\"quoted\\\" \\\\ value\"\n",
        )
    );
    assert_eq!(
        std::fs::metadata(&env_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let parent = std::fs::metadata(directory.path()).unwrap();
    assert_eq!(
        host.calls.into_inner(),
        [format!(
            "chown {} {}:{}",
            env_path.display(),
            parent.uid(),
            parent.gid()
        )]
    );
}

#[test]
fn a_computer_without_an_agent_has_no_brain_environment() {
    let directory = tempfile::tempdir().expect("temp dir");
    let config = directory.path().join("macrod.toml");
    let env_path = directory.path().join("agent.env");
    std::fs::write(&env_path, "MACRO_API_KEY=\"stale\"\n").unwrap();

    write_agent_env(&env_path, None, &config, &FakeHost::default()).unwrap();
    assert!(!env_path.exists());
    // Nothing to remove is fine too.
    write_agent_env(&env_path, None, &config, &FakeHost::default()).unwrap();
}
