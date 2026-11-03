use std::collections::BTreeMap;

use serde_json::json;

use super::*;

fn shared() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("SHARED".to_string(), "1".to_string()),
        ("ORIGIN".to_string(), "https://localhost:1".to_string()),
    ])
}

#[test]
fn renders_a_service_from_compose() {
    let dir = std::env::temp_dir().join(format!("macro-env-render-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("kick")).unwrap();
    std::fs::write(dir.join("kick/kickstart.json"), "{}").unwrap();
    std::fs::write(dir.join("Caddyfile"), ":8080 {}").unwrap();
    let compose = json!({ "services": {
        "email_service": {
            "image": "macro-local-runtime:dev",
            "command": ["/app/out/email_service"],
            "environment": {
                "SHARED": "1",
                "ORIGIN": "https://localhost:1",
                "PORT": "8080",
                "OVERRIDE_X": "https://localhost:1/x",
                "EMPTY": null,
            },
            "ports": [{ "target": 8080, "published": "20087" }],
            "networks": { "services": { "aliases": ["email-service", "mail_alias"] } },
            "healthcheck": {
                "test": ["CMD", "curl", "-f", "http://localhost:8080/health"],
                "interval": "30s",
                "timeout": "10s",
                "retries": 3,
            },
            "volumes": [
                { "type": "bind", "source": "/target/debug", "target": "/app/out" },
                { "type": "bind", "source": "/var/run/docker.sock", "target": "/var/run/docker.sock" },
            ],
            "stop_grace_period": "2m",
        },
        "fusionauth": {
            "image": "fusionauth/fusionauth-app:1.62.1",
            "volumes": [
                { "type": "volume", "source": "fusionauth_config", "target": "/usr/local/fusionauth/config" },
                { "type": "bind", "source": dir.join("kick").display().to_string(), "target": "/usr/local/fusionauth/kickstart" },
            ],
            "healthcheck": { "test": ["CMD-SHELL", "curl -s localhost | grep -q Ok"] },
        },
        "proxy": {
            "image": "caddy:2-alpine",
            "environment": { "PROXY_PORT": "20000" },
            "ports": [{ "target": 20000 }],
            "volumes": [
                { "type": "bind", "source": dir.join("Caddyfile").display().to_string(), "target": "/etc/caddy/Caddyfile" },
            ],
        },
        "sdk-webhook-relay": { "image": "relay" },
    }});
    let images = BTreeMap::from([(
        "email_service".to_string(),
        "macro-env/services:abc".to_string(),
    )]);
    let shared = shared();
    let rewrites = vec![(
        "https://localhost:1".to_string(),
        "https://demo.example".to_string(),
    )];
    let rendered = render(
        &compose,
        &Inputs {
            shared_env: &shared,
            images: &images,
            rewrites: &rewrites,
        },
    )
    .unwrap();

    let names: Vec<&str> = rendered.workloads.iter().map(|w| w.name.as_str()).collect();
    assert_eq!(names, ["email-service", "fusionauth", "proxy"]);

    let email = &rendered.workloads[0];
    assert!(!email.infra);
    assert!(email.shared_env);
    assert_eq!(email.image, "macro-env/services:abc");
    assert_eq!(email.args, ["/app/out/email_service"]);
    // Shared values are left to the Secret; overrides keep and rewrite theirs.
    assert_eq!(
        email.env,
        BTreeMap::from([
            (
                "OVERRIDE_X".to_string(),
                "https://demo.example/x".to_string()
            ),
            ("PORT".to_string(), "8080".to_string()),
        ])
    );
    assert_eq!(email.ports, [8080]);
    assert_eq!(email.aliases, ["mail-alias"]);
    assert!(email.volumes.is_empty() && email.files.is_empty());
    assert_eq!(email.termination_grace_period_seconds, Some(120));
    let probe = email.probe.as_ref().unwrap();
    assert_eq!(probe.exec, ["curl", "-f", "http://localhost:8080/health"]);
    assert_eq!(probe.period_seconds, 30);

    let fa = &rendered.workloads[1];
    assert!(fa.infra);
    assert!(!fa.shared_env);
    assert_eq!(fa.volumes[0].name, "fusionauth-config");
    assert_eq!(fa.files[0].mount_path, "/usr/local/fusionauth/kickstart");
    assert_eq!(fa.files[0].sub_path, None);
    assert_eq!(
        rendered.config_maps[&fa.files[0].config_map]["kickstart.json"],
        "{}"
    );
    assert_eq!(
        fa.probe.as_ref().unwrap().exec,
        ["sh", "-c", "curl -s localhost | grep -q Ok"]
    );

    let proxy = &rendered.workloads[2];
    assert_eq!(proxy.ports, [PROXY_PORT]);
    assert_eq!(proxy.env["PROXY_PORT"], "8080");
    assert_eq!(proxy.files[0].sub_path.as_deref(), Some("Caddyfile"));

    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn large_bind_mounts_are_baked() {
    let dir = std::env::temp_dir().join(format!("macro-env-bake-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("dist/assets")).unwrap();
    let compose = json!({ "services": { "proxy": {
        "image": "caddy",
        "volumes": [{ "type": "bind", "source": dir.join("dist").display().to_string(), "target": "/srv/frontend" }],
    }}});
    let baked = large_bind_mounts(&compose).unwrap();
    assert_eq!(baked.len(), 1);
    assert_eq!(baked[0].target, "/srv/frontend");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn missing_bind_sources_are_skipped() {
    let compose = json!({ "services": { "x": {
        "image": "x",
        "volumes": [{ "type": "bind", "source": "/definitely/not/here", "target": "/etc/x" }],
    }}});
    assert!(large_bind_mounts(&compose).unwrap().is_empty());
    let none = BTreeMap::new();
    let rendered = render(
        &compose,
        &Inputs {
            shared_env: &none,
            images: &none,
            rewrites: &[],
        },
    )
    .unwrap();
    assert!(rendered.workloads[0].files.is_empty());
}

#[test]
fn parses_compose_durations() {
    assert_eq!(parse_duration("30s").unwrap(), 30);
    assert_eq!(parse_duration("1m30s").unwrap(), 90);
    assert_eq!(parse_duration("1500ms").unwrap(), 1);
    assert_eq!(parse_duration("2h").unwrap(), 7200);
    assert!(parse_duration("30").is_err());
    assert!(parse_duration("3d").is_err());
}
