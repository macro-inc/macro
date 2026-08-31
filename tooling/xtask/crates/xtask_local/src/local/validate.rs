//! `validate-local-compose` and `validate-local-env`.
//!
//! These are the durable guards behind the spec's hard invariants: no Rust
//! service builds in Docker for the local path, and local mode never requires
//! Pulumi / real AWS / real SES.

use anyhow::{Context, Result, bail};
use serde_json::Value;

use super::build::{BinariesDir, RUNTIME_IMAGE_TAG};
use super::instance::Port;
use super::inventory::services_for_mode;
use super::{Mode, arch, env_layer, gen_compose, instance::Instance, workspace_root};

/// Required non-Rust services that must be present in the rendered local
/// compose.
const REQUIRED_NON_RUST: &[&str] = &[
    "postgres",
    "redis",
    "kafka",
    "fusionauth",
    "localstack",
    "mailpit",
];

/// Render the merged compose config and assert every Rust service is a
/// runtime-image container with no `build:` and an `/app/out` mount, and that
/// the required non-Rust services exist. Runs once per frontend flavor
/// (static bundle vs dev server): the validator cannot know which one the
/// developer will launch, so it must hold for both.
pub fn local_compose(instance: &Instance, mode: Mode) -> Result<()> {
    for static_frontend in [true, false] {
        local_compose_flavor(instance, mode, static_frontend)?;
    }
    Ok(())
}

fn local_compose_flavor(instance: &Instance, mode: Mode, static_frontend: bool) -> Result<()> {
    // Generate the override against the expected (possibly not-yet-built)
    // target dir — config rendering does not need the binaries to exist.
    let target = arch::detect()?;
    let binaries = BinariesDir::TargetDir(workspace_root().join(target.debug_dir()));
    // Resolve first: the gmail_forwarder sidecar is gated on the resolved env
    // exactly as `prepare` gates it, so the validated compose matches what a
    // real bring-up with this env would generate.
    let resolved = env_layer::resolve(mode, instance, true, None, static_frontend, None)?;
    let gmail_forwarder = resolved
        .merged
        .get("GMAIL_FORWARDER_SA_KEY")
        .is_some_and(|key| !key.trim().is_empty());
    gen_compose::generate(mode, instance, &binaries, static_frontend, gmail_forwarder)?;

    let files = gen_compose::compose_files(instance);
    let mut cmd = gen_compose::docker_compose(instance, &files, &resolved.generated_path);
    cmd.args(["config", "--format", "json"]);
    let out = cmd.output().context("running `docker compose config`")?;
    if !out.status.success() {
        bail!(
            "`docker compose config` failed:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let cfg: Value = serde_json::from_slice(&out.stdout).context("parsing compose config json")?;
    let services = cfg.get("services").and_then(Value::as_object);
    let Some(services) = services else {
        bail!("rendered compose has no services");
    };

    let mut failures: Vec<String> = Vec::new();
    for svc in services_for_mode(mode) {
        let Some(node) = services.get(svc.compose_name) else {
            failures.push(format!(
                "Rust service '{}' is missing from the rendered compose",
                svc.compose_name
            ));
            continue;
        };
        if node.get("build").map(|b| !b.is_null()).unwrap_or(false) {
            failures.push(format!(
                "'{}' still has a build: stanza — the local path must mount prebuilt binaries, not build in Docker",
                svc.compose_name
            ));
        }
        match node.get("image").and_then(Value::as_str) {
            Some(img) if img == RUNTIME_IMAGE_TAG => {}
            other => failures.push(format!(
                "'{}' image is {:?}, expected {RUNTIME_IMAGE_TAG}",
                svc.compose_name, other
            )),
        }
        if !has_app_out_mount(node) {
            failures.push(format!(
                "'{}' is missing the /app/out bind mount",
                svc.compose_name
            ));
        }
    }
    for required in REQUIRED_NON_RUST {
        if !services.contains_key(*required) {
            failures.push(format!("required non-Rust service '{required}' is absent"));
        }
    }
    // The sidecar is not in `services_for_mode` (modes-less inventory entry) —
    // assert its presence and runtime-image shape when the env gates it in.
    if gmail_forwarder {
        match services.get("gmail_forwarder") {
            None => failures.push(
                "gmail_forwarder sidecar is absent although GMAIL_FORWARDER_SA_KEY is set".into(),
            ),
            Some(node) if !has_app_out_mount(node) => {
                failures.push("gmail_forwarder is missing the /app/out bind mount".into());
            }
            Some(_) => {}
        }
    }

    if !failures.is_empty() {
        bail!(
            "validate-local-compose ({}) failed:\n  - {}",
            flavor_label(static_frontend),
            failures.join("\n  - ")
        );
    }
    println!(
        "validate-local-compose ({}): OK ({} Rust services{})",
        flavor_label(static_frontend),
        services_for_mode(mode).count(),
        if gmail_forwarder {
            " + gmail_forwarder"
        } else {
            ""
        }
    );
    Ok(())
}

fn flavor_label(static_frontend: bool) -> &'static str {
    if static_frontend {
        "static frontend"
    } else {
        "dev-server frontend"
    }
}

fn has_app_out_mount(service: &Value) -> bool {
    let Some(volumes) = service.get("volumes").and_then(Value::as_array) else {
        return false;
    };
    volumes.iter().any(|v| match v {
        // Normalized form: { type, source, target, ... }.
        Value::Object(map) => map.get("target").and_then(Value::as_str) == Some("/app/out"),
        // Short form: "src:/app/out:ro".
        Value::String(s) => s.split(':').nth(1) == Some("/app/out"),
        _ => false,
    })
}

/// Resolve the env layers and assert mode-appropriate invariants, once per
/// frontend flavor — the validator cannot know which one the developer will
/// launch, so both must resolve to a sane configuration.
pub fn local_env(
    instance: &Instance,
    mode: Mode,
    no_doppler: bool,
    env_file: Option<&std::path::Path>,
) -> Result<()> {
    for static_frontend in [true, false] {
        local_env_flavor(instance, mode, no_doppler, env_file, static_frontend)?;
    }
    Ok(())
}

fn local_env_flavor(
    instance: &Instance,
    mode: Mode,
    no_doppler: bool,
    env_file: Option<&std::path::Path>,
    static_frontend: bool,
) -> Result<()> {
    let resolved = env_layer::resolve(mode, instance, no_doppler, env_file, static_frontend, None)?;
    let env = &resolved.merged;
    let mut failures: Vec<String> = Vec::new();

    let require = |failures: &mut Vec<String>, key: &str| {
        if !env.contains_key(key) {
            failures.push(format!("missing required env '{key}'"));
        }
    };

    match mode {
        Mode::Local => {
            for key in [
                "DATABASE_URL",
                "REDIS_URI",
                "LOCAL_AWS_URL",
                "FUSIONAUTH_BASE_URL",
                "FUSIONAUTH_PUBLIC_URL",
                "FUSIONAUTH_CLIENT_ID",
                "JWT_SECRET_KEY",
                "DOCUMENT_STORAGE_BUCKET",
            ] {
                require(&mut failures, key);
            }
            // No real AWS creds locally.
            if env.get("AWS_ACCESS_KEY_ID").map(String::as_str) != Some("test") {
                failures.push(
                    "AWS_ACCESS_KEY_ID is not the local dummy 'test' — refusing real AWS creds locally".into(),
                );
            }
            // Endpoints must be local docker hosts.
            for (key, host) in [
                ("FUSIONAUTH_BASE_URL", "fusionauth"),
                ("LOCAL_AWS_URL", "localstack"),
                ("DATABASE_URL", "postgres"),
                ("REDIS_URI", "redis"),
            ] {
                if let Some(v) = env.get(key)
                    && !v.contains(host)
                    && !v.contains("localhost")
                {
                    failures.push(format!(
                        "{key}={v} is not a local endpoint (expected host '{host}')"
                    ));
                }
            }
            // The post-login redirect must point at where this flavor
            // actually serves the app (proxy for static, dev server port
            // otherwise) — the exact drift this per-flavor pass exists to
            // catch.
            let expected_frontend_port = if static_frontend {
                instance.port(Port::Proxy)
            } else {
                instance.port(Port::Frontend)
            };
            if env.get("FRONTEND_PORT") != Some(&expected_frontend_port.to_string()) {
                failures.push(format!(
                    "FRONTEND_PORT={:?} does not match the {} port {expected_frontend_port}",
                    env.get("FRONTEND_PORT"),
                    flavor_label(static_frontend),
                ));
            }
        }
        Mode::Dev => {
            // run-dev runs as macro_env `local` *on purpose*: dev_personal ships
            // real values, not Secrets-Manager names, so a `dev`/`develop`
            // macro_env would make services try to fetch each value as a secret.
            // Its "dev-ness" comes from the values (dev DB, real AWS), not this.
            if env.get("ENVIRONMENT").map(String::as_str) != Some("local") {
                failures.push(
                    "run-dev resolves ENVIRONMENT=local (dev values, local macro_env)".into(),
                );
            }
            if env.get("LOCAL_AWS_URL").is_some() {
                failures.push(
                    "run-dev must not set LOCAL_AWS_URL (would point SES/S3 at LocalStack)".into(),
                );
            }
            match env.get("DATABASE_URL") {
                None => failures.push("run-dev requires a dev DATABASE_URL (none found)".into()),
                Some(v) if env_layer::is_local_database_url(v) => {
                    failures.push(format!(
                        "run-dev DATABASE_URL={v} points at local infra; expected a shared-dev host"
                    ));
                }
                Some(_) => {}
            }
        }
    }

    if !failures.is_empty() {
        bail!(
            "validate-local-env ({}, {}) failed:\n  - {}",
            mode.label(),
            flavor_label(static_frontend),
            failures.join("\n  - ")
        );
    }
    println!(
        "validate-local-env ({}, {}): OK — {}",
        mode.label(),
        flavor_label(static_frontend),
        env_layer::summarize(env)
    );
    Ok(())
}
