//! The final startup summary (the spec's Output Contract).

use std::path::Path;

use console::Style;

use super::env_layer::ResolvedEnv;
use super::instance::{Instance, Port};
use super::{Mode, frontend, mailpit, proxy, sdk_webhook};

/// The host-facing endpoints of an instance: (label, url, host port).
/// Shared by the startup summary and `status-local`.
pub fn endpoint_rows(instance: &Instance) -> Vec<(&'static str, String, u16)> {
    // Headless stacks serve the app from the proxy origin; showing the
    // dev-server URL there reads as "frontend down" when nothing is wrong.
    let (frontend_url, frontend_port) = if super::stack::frontend_is_static(instance) {
        (frontend::static_url(instance), instance.port(Port::Proxy))
    } else {
        (frontend::url(instance), instance.port(Port::Frontend))
    };
    vec![
        ("frontend", frontend_url, frontend_port),
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
/// direct-versus-single-origin distinction. `shared_app_url` is the public
/// app tunnel when `--with-cf-tunnel` opened one — passed explicitly because,
/// unlike the egress tunnel, it is not written into the env.
pub fn print(
    mode: Mode,
    instance: &Instance,
    env: &ResolvedEnv,
    frontend_url: &str,
    mailpit_url: &str,
    shared_app_url: Option<&str>,
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
    if mode == Mode::Local {
        row(
            "SDK config",
            instance
                .artifact_dir()
                .join("portmap.json")
                .display()
                .to_string(),
        );
        row("Receive webhooks at", sdk_webhook::relay_url().to_string());
    }
    // The Cursor egress tunnel, when one opened this run: a public
    // `EGRESS_BASE_URL` is always a tunnel, and the in-network default is not
    // worth a row.
    if let Some(url) = env.merged.get("EGRESS_BASE_URL")
        && url.starts_with("https://")
    {
        row("cursor egress", url.clone());
    }
    // The public app tunnel (`--with-cf-tunnel`) — the URL to hand a friend.
    if let Some(url) = shared_app_url {
        row("shared app", url.to_string());
    }
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
    if let Some(url) = traces_url() {
        row("traces", url);
    }
    if let Some(url) = dd_logs_url() {
        row("dd logs", url);
    }

    row("logs", logs_command(instance, &env.generated_path));
    row("stop", stop_command(instance));
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
    macro_env_var::maybe_read_env("DD_ENV").unwrap_or_else(|| "local".into())
}

/// Whether something is listening on `port` on localhost.
pub(super) fn port_open(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        std::time::Duration::from_millis(150),
    )
    .is_ok()
}
