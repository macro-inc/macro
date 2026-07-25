//! The final startup summary (the spec's Output Contract).

use console::Style;

use super::env_layer::ResolvedEnv;
use super::instance::{Instance, Port};
use super::{Mode, frontend, mailpit, proxy};

/// Print the mode/instance/endpoints block after a successful startup.
pub fn print(mode: Mode, instance: &Instance, env: &ResolvedEnv) {
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
    row("frontend", frontend::url(instance));

    if mode.spec().show_infra_in_summary {
        row("proxy", proxy::url(instance));
        row(
            "fusionauth",
            format!("http://localhost:{}", instance.port(Port::FusionAuth)),
        );
        row("mailpit", mailpit::ui_url(instance));
        row(
            "localstack",
            format!("http://localhost:{}", instance.port(Port::LocalStack)),
        );
        row(
            "postgres",
            format!(
                "postgres://user:password@localhost:{}/macrodb",
                instance.port(Port::Postgres)
            ),
        );
        row(
            "redis",
            format!("redis://localhost:{}", instance.port(Port::Redis)),
        );
        row("kafka", format!("localhost:{}", instance.port(Port::Kafka)));
    }

    if let Some(url) = traces_url() {
        row("traces", url);
    }
    if let Some(url) = dd_logs_url() {
        row("dd logs", url);
    }

    let repo_root = super::repo_root();
    let base_compose = repo_root.join("docker/docker-compose.yml");
    let override_compose = instance.artifact_dir().join("docker-compose.override.yml");
    row(
        "logs",
        format!(
            "MACRO_ENV_FILE={:?} docker compose --project-directory {:?} -p {} -f {:?} -f {:?} --env-file {:?} logs -f",
            env.generated_path,
            repo_root,
            instance.project_name(),
            base_compose,
            override_compose,
            env.generated_path,
        ),
    );
    let stop = if instance.is_default() {
        "just stop_local".to_string()
    } else {
        format!("just stop_local --instance {}", instance.name())
    };
    row("stop", stop);
    println!();
}

/// The trace viewer for the OTel spans the web app emits, if one is running.
///
/// The viewers are global (fixed ports, one per machine, started manually via
/// compose profiles — see `docker/docker-compose.yml`), so this probes rather
/// than consulting the instance: the Jaeger UI on 16686, else a Datadog agent
/// on the OTLP port 4318, whose traces land in the Datadog APM UI under the
/// `env:` its compose profile sets (`DD_ENV`, default `local`).
fn traces_url() -> Option<String> {
    if port_open(16686) {
        return Some("http://localhost:16686".into());
    }
    if port_open(4318) {
        return Some(format!(
            "https://us5.datadoghq.com/apm/traces?query=env%3A{}",
            dd_env()
        ));
    }
    None
}

/// The Datadog Logs Explorer for the OTel log records the web app emits —
/// only when the Datadog agent is the running collector (Jaeger has no log
/// UI; its OTLP logs are dropped).
fn dd_logs_url() -> Option<String> {
    if port_open(16686) || !port_open(4318) {
        return None;
    }
    Some(format!(
        "https://us5.datadoghq.com/logs?query=env%3A{}",
        dd_env()
    ))
}

fn dd_env() -> String {
    std::env::var("DD_ENV").unwrap_or_else(|_| "local".into())
}

/// Whether something is listening on `port` on localhost.
pub(super) fn port_open(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        std::time::Duration::from_millis(150),
    )
    .is_ok()
}
