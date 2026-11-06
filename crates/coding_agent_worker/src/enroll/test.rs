use std::cell::RefCell;

use hosted_runtimes::domain::enrollment::{PersonaConfigKey, PersonaService};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use uuid::Uuid;

use super::*;

const ENROLLMENT_JSON: &str = r#"{
    "computer_id": "00000000-0000-0000-0000-00000000000c",
    "pairing_id": "00000000-0000-0000-0000-00000000000a",
    "device_secret": "mhds_secret",
    "name": "Standard computer",
    "service_url_overrides": {
        "OVERRIDE_AGENT_HARNESS_SERVICE_URL": "http://10.200.0.1:41009/agent-harness/",
        "OVERRIDE_AGENT_HARNESS_EGRESS_URL": "http://10.200.0.1:41027",
        "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL": "http://10.200.0.1:41009/dss",
        "OVERRIDE_APP_SERVICE_URL": "http://10.200.0.1:41000"
    },
    "persona": {
        "name": "Ada 100%",
        "os_user": "agent-ada",
        "extra_service": {
            "unit_name": "macro-brain-agent-ada",
            "exec": "/usr/local/bin/brain --persona ada",
            "env": { "BRAIN_MODE": "say \"hi\" 50%" }
        },
        "config": { "MACRO_TOKEN": "a$b\"c", "PERSONA": "ada" }
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
    fn ensure_user(&self, os_user: &PersonaOsUser) -> rootcause::Result<Ownership> {
        self.calls
            .borrow_mut()
            .push(format!("ensure_user {os_user}"));
        Ok(Ownership {
            uid: 1001,
            gid: 1002,
        })
    }

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

#[test]
fn persona_installs_its_user_environment_and_unit() {
    let root = tempfile::tempdir().expect("temp dir");
    let paths = SystemPaths {
        root: root.path().to_owned(),
    };
    let persona = enrollment().persona.expect("the literal has a persona");
    let files = PersonaFiles::render(&persona, &paths).expect("valid persona");
    let host = FakeHost::default();
    files.install(&host).expect("install");

    let env_path = root.path().join("etc/macro/personas/agent-ada.env");
    assert_eq!(
        std::fs::read_to_string(&env_path).unwrap(),
        "MACRO_TOKEN=\"a\\$b\\\"c\"\nPERSONA=\"ada\"\n"
    );
    assert_eq!(
        std::fs::metadata(&env_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let unit_path = root
        .path()
        .join("etc/systemd/system/macro-brain-agent-ada.service");
    assert_eq!(
        std::fs::read_to_string(&unit_path).unwrap(),
        "# Written by macrod enroll.\n\
         [Unit]\n\
         Description=Macro persona Ada 100%%\n\
         After=network-online.target macrod.service\n\
         Wants=network-online.target\n\
         \n\
         [Service]\n\
         User=agent-ada\n\
         WorkingDirectory=~\n\
         EnvironmentFile=/etc/macro/personas/agent-ada.env\n\
         Environment=\"BRAIN_MODE=say \\\"hi\\\" 50%%\"\n\
         ExecStart=/usr/local/bin/brain --persona ada\n\
         Restart=always\n\
         RestartSec=5\n\
         \n\
         [Install]\n\
         WantedBy=multi-user.target\n"
    );
    assert_eq!(
        host.calls.into_inner(),
        [
            "ensure_user agent-ada".to_owned(),
            format!("chown {} 1001:1002", env_path.display()),
            "systemctl daemon-reload".to_owned(),
            "systemctl enable --now --no-block macro-brain-agent-ada.service".to_owned(),
        ]
    );

    // A retry rewrites the same files.
    files.install(&FakeHost::default()).expect("reinstall");
}

#[test]
fn persona_exec_is_validated_before_anything_is_written() {
    let paths = SystemPaths {
        root: PathBuf::from("/nonexistent"),
    };
    let persona = enrollment().persona.expect("the literal has a persona");
    for os_user in [
        "ada",
        "legacy-persona",
        "agent-",
        "agent-root/../x",
        "root",
        "Ada",
        "1ada",
        "ada/../x",
        "",
        "agent-a234567890123456789012345678901x",
    ] {
        let mut bad = serde_json::to_value(&persona).expect("persona");
        bad["os_user"] = serde_json::json!(os_user);
        if let Ok(bad) = serde_json::from_value::<Persona>(bad) {
            assert!(
                PersonaFiles::render(&bad, &paths).is_err(),
                "invalid agent OS user accepted"
            );
        }
    }
    for unit_name in ["macrod", "macrod-enroll", "brain service", "../brain", ""] {
        let mut bad = serde_json::to_value(&persona).expect("persona");
        bad["extra_service"]["unit_name"] = serde_json::json!(unit_name);
        assert!(
            serde_json::from_value::<Persona>(bad).is_err(),
            "invalid unit accepted"
        );
    }

    let bad_exec = Persona {
        extra_service: PersonaService {
            exec: "/bin/brain\nExecStartPre=/bin/evil".to_owned(),
            ..persona.extra_service.clone()
        },
        ..persona.clone()
    };
    assert!(PersonaFiles::render(&bad_exec, &paths).is_err());
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
    assert_eq!(enrollment.pairing_id.into_inner(), Uuid::from_u128(0xa));

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

#[test]
fn a_recreated_guest_installs_its_saved_persona_and_enables_the_unit_idempotently() {
    let original = tempfile::tempdir().unwrap();
    let recreated = tempfile::tempdir().unwrap();
    let persona = Persona {
        config: BTreeMap::from([
            (
                PersonaConfigKey::parse("REPO_URL").unwrap(),
                "https://example.com/repository.git".to_owned(),
            ),
            (
                PersonaConfigKey::parse("AGENT_ID").unwrap(),
                "saved-agent".to_owned(),
            ),
        ]),
        ..enrollment().persona.unwrap()
    };
    for root in [original.path(), recreated.path()] {
        let paths = SystemPaths {
            root: root.to_owned(),
        };
        let files = PersonaFiles::render(&persona, &paths).unwrap();
        let host = FakeHost::default();
        let env_path = root.join("etc/macro/personas/agent-ada.env");
        let unit_path = root.join("etc/systemd/system/macro-brain-agent-ada.service");
        assert!(!env_path.exists());
        assert!(!unit_path.exists());

        for _ in 0..2 {
            host.calls.borrow_mut().clear();
            files.install(&host).unwrap();
            assert_eq!(
                std::fs::read_to_string(&env_path).unwrap(),
                "AGENT_ID=\"saved-agent\"\nREPO_URL=\"https://example.com/repository.git\"\n"
            );
            let unit = std::fs::read_to_string(&unit_path).unwrap();
            assert!(unit.contains("EnvironmentFile=/etc/macro/personas/agent-ada.env\n"));
            assert!(unit.contains("ExecStart=/usr/local/bin/brain --persona ada\n"));
            assert_eq!(
                *host.calls.borrow(),
                vec![
                    "ensure_user agent-ada".to_owned(),
                    format!("chown {} 1001:1002", env_path.display()),
                    "systemctl daemon-reload".to_owned(),
                    "systemctl enable --now --no-block macro-brain-agent-ada.service".to_owned(),
                ]
            );
        }
    }
}

#[tokio::test]
async fn old_persona_names_fail_clearly_before_enrollment_side_effects() {
    let root = tempfile::tempdir().expect("root");
    let file = root.path().join("enrollment.json");
    let mut raw: serde_json::Value = serde_json::from_str(ENROLLMENT_JSON).expect("fixture");
    raw["persona"]["os_user"] = serde_json::json!("legacy-persona");
    std::fs::write(&file, serde_json::to_vec(&raw).expect("serialize")).expect("write enrollment");
    let config = root.path().join("etc/macrod/macrod.toml");
    let host = FakeHost::default();
    let error = run_enroll_with_host(
        EnrollOptions {
            from: EnrollmentSource::File(file),
            config: config.clone(),
            workspace: root.path().join("workspace"),
            agent: "claude".to_owned(),
            root: root.path().to_owned(),
        },
        &host,
    )
    .await
    .expect_err("old persona must be rejected");
    assert!(format!("{error:?}").contains("agent-"));
    assert!(!config.exists());
    assert!(!root.path().join("etc/macro/personas").exists());
    assert!(host.calls.into_inner().is_empty());
}
