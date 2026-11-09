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
    "service_url_overrides": {
        "OVERRIDE_AGENT_HARNESS_SERVICE_URL": "http://10.200.0.1:41009/agent-harness/",
        "OVERRIDE_AGENT_HARNESS_EGRESS_URL": "http://10.200.0.1:41027",
        "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL": "http://10.200.0.1:41009/dss",
        "OVERRIDE_APP_SERVICE_URL": "http://10.200.0.1:41000"
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

    fn systemctl(&self, args: &[&str]) -> rootcause::Result<()> {
        self.calls
            .borrow_mut()
            .push(format!("systemctl {}", args.join(" ")));
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
fn deployment_urls_come_from_the_three_overrides_macrod_calls() {
    let urls = DeploymentUrls::from_overrides(&enrollment().service_url_overrides)
        .expect("valid overrides");
    assert_eq!(
        urls,
        Some(DeploymentUrls {
            egress_url: Some("http://10.200.0.1:41027".to_owned()),
            api_url: "http://10.200.0.1:41009/agent-harness".to_owned(),
            storage_url: "http://10.200.0.1:41009/dss".to_owned(),
            web_url: "http://10.200.0.1:41000/app".to_owned(),
        })
    );

    // Overrides for services macrod never calls leave its deployment alone.
    let unrelated = BTreeMap::from([(
        "OVERRIDE_MCP_SERVICE_URL".to_owned(),
        "http://10.200.0.1:41101".to_owned(),
    )]);
    assert_eq!(DeploymentUrls::from_overrides(&unrelated).unwrap(), None);

    let partial = BTreeMap::from([(
        "OVERRIDE_AGENT_HARNESS_SERVICE_URL".to_owned(),
        "http://10.200.0.1:41009/agent-harness".to_owned(),
    )]);
    assert!(DeploymentUrls::from_overrides(&partial).is_err());

    let not_an_override = BTreeMap::from([(
        "AGENT_HARNESS_SERVICE_URL".to_owned(),
        "http://10.200.0.1:41009".to_owned(),
    )]);
    assert!(DeploymentUrls::from_overrides(&not_an_override).is_err());

    let not_a_url = BTreeMap::from([(
        "OVERRIDE_APP_SERVICE_URL".to_owned(),
        "not a url".to_owned(),
    )]);
    assert!(DeploymentUrls::from_overrides(&not_a_url).is_err());
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
        enrollment()
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
        enrollment()
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
    let urls = DeploymentUrls::from_overrides(&enrollment.service_url_overrides).unwrap();

    write_config(&options, None, urls.as_ref()).unwrap();
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
async fn an_enrolled_computer_refreshes_only_its_privileged_token_store() {
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
    assert_eq!(
        host.calls.into_inner(),
        [
            "systemctl daemon-reload",
            "systemctl enable --now macrod-token-store.service",
        ]
    );
    let unit = std::fs::read_to_string(
        directory
            .path()
            .join("etc/systemd/system/macrod-token-store.service"),
    )
    .unwrap();
    assert!(unit.contains("User=root\n"));
    assert!(unit.contains("computer-token-store --owner "));
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
