//! The final startup summary (the spec's Output Contract).

use std::path::Path;

use console::Style;

use super::env_layer::ResolvedEnv;
use super::instance::{Instance, Port};
use super::{Mode, frontend, mailpit, proxy};

/// The host-facing endpoints of an instance: (label, url, host port).
/// Shared by the startup summary and `status-local`.
pub fn endpoint_rows(instance: &Instance) -> Vec<(&'static str, String, u16)> {
    vec![
        (
            "frontend",
            frontend::url(instance),
            instance.port(Port::Frontend),
        ),
        ("proxy", proxy::url(instance), instance.port(Port::Proxy)),
        (
            "fusionauth",
            format!("http://localhost:{}", instance.port(Port::FusionAuth)),
            instance.port(Port::FusionAuth),
        ),
        (
            "mailpit",
            mailpit::direct_ui_url(instance),
            instance.port(Port::MailpitUi),
        ),
        (
            "localstack",
            format!("http://localhost:{}", instance.port(Port::LocalStack)),
            instance.port(Port::LocalStack),
        ),
        (
            "postgres",
            format!(
                "postgres://user:password@localhost:{}/macrodb",
                instance.port(Port::Postgres)
            ),
            instance.port(Port::Postgres),
        ),
        (
            "redis",
            format!("redis://localhost:{}", instance.port(Port::Redis)),
            instance.port(Port::Redis),
        ),
        (
            "kafka",
            format!("localhost:{}", instance.port(Port::Kafka)),
            instance.port(Port::Kafka),
        ),
    ]
}

/// The `docker compose logs -f` invocation for the instance.
pub fn logs_command(instance: &Instance, generated_env: &Path) -> String {
    let repo_root = super::repo_root();
    let base_compose = repo_root.join("docker/docker-compose.yml");
    let override_compose = instance.artifact_dir().join("docker-compose.override.yml");
    format!(
        "MACRO_ENV_FILE={:?} docker compose --project-directory {:?} -p {} -f {:?} -f {:?} --env-file {:?} logs -f",
        generated_env,
        repo_root,
        instance.project_name(),
        base_compose,
        override_compose,
        generated_env,
    )
}

/// The `just stop_local` invocation for the instance.
pub fn stop_command(instance: &Instance) -> String {
    if instance.is_default() {
        "just stop_local".to_string()
    } else {
        format!("just stop_local --instance {}", instance.name())
    }
}

/// Print the mode/instance/endpoints block after a successful startup.
/// `frontend_url` differs by flow: the dev-server origin for `run_local`, the
/// proxy-served bundle for headless `stack up`; `mailpit_url` follows the same
/// direct-versus-single-origin distinction.
pub fn print(
    mode: Mode,
    instance: &Instance,
    env: &ResolvedEnv,
    frontend_url: &str,
    mailpit_url: &str,
) {
    let key = Style::new().dim();
    let link = Style::new().cyan();
    let row = |k: &str, v: String| {
        // Tint anything that looks like a clickable endpoint.
        let v =
            if v.starts_with("http") || v.starts_with("redis://") || v.starts_with("postgres://") {
                link.apply_to(v).to_string()
            } else {
                v
            };
        println!("  {}{v}", key.apply_to(format!("{k:<16}")));
    };
    println!();
    println!(
        "{}",
        Style::new()
            .green()
            .bold()
            .apply_to(format!("✓ macro {} stack ready", mode.label()))
    );
    row("mode", mode.label().to_string());
    row(
        "instance",
        format!("{} (project {})", instance.name(), instance.project_name()),
    );
    row(
        "env source",
        if mode.spec().overlay_local_env {
            "code (LocalEnv)".to_string()
        } else if env.doppler_used {
            format!("Doppler {}", mode.spec().doppler_config)
        } else {
            "--env-file / process env".to_string()
        },
    );
    row(
        "env file",
        env.env_file
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "(none)".into()),
    );
    row("generated env", env.generated_path.display().to_string());
    // The frontend and mailpit rows come from the caller (they differ by
    // flow); the rest of the endpoint list is shared with `status-local`.
    for (label, url, _port) in endpoint_rows(instance) {
        if label != "frontend" && !mode.spec().show_infra_in_summary {
            continue;
        }
        let value = match label {
            "frontend" => frontend_url.to_string(),
            "mailpit" => mailpit_url.to_string(),
            _ => url,
        };
        row(label, value);
    }
    row("logs", logs_command(instance, &env.generated_path));
    row("stop", stop_command(instance));
    println!();
}
