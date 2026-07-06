//! The final startup summary (the spec's Output Contract).

use console::Style;

use super::env_layer::ResolvedEnv;
use super::instance::{Instance, Port};
use super::{frontend, mailpit, proxy, Mode};

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

    row(
        "logs",
        format!("docker compose -p {} logs -f", instance.project_name()),
    );
    let stop = if instance.is_default() {
        "just stop_local".to_string()
    } else {
        format!("just stop_local --instance {}", instance.name())
    };
    row("stop", stop);
    println!();
}
