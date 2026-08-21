//! `status-local`: an on-demand view of an instance's stack — the endpoint
//! list with live TCP probes plus per-container states. Read-only: nothing is
//! built, started, or regenerated.

use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use anyhow::Result;
use console::Style;

use super::instance::Instance;
use super::{docker, summary};

/// Whether something on the host is accepting connections on `port`.
fn listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Print endpoints (with reachability) and container states for `instance`.
pub fn run(instance: &Instance) -> Result<()> {
    let dim = Style::new().dim();
    let link = Style::new().cyan();
    let up = Style::new().green().apply_to("●").to_string();
    let down = dim.apply_to("○").to_string();

    println!();
    println!(
        "{}",
        Style::new().bold().apply_to(format!(
            "macro local stack — instance {} (project {})",
            instance.name(),
            instance.project_name()
        ))
    );
    println!();

    println!(
        "  {}",
        dim.apply_to("endpoints (● listening / ○ not answering)")
    );
    for (label, url, port) in summary::endpoint_rows(instance) {
        let dot = if listening(port) { &up } else { &down };
        println!(
            "  {dot} {}{}",
            dim.apply_to(format!("{label:<14}")),
            link.apply_to(url)
        );
    }
    println!();

    match docker::project_containers(instance.project_name()) {
        Ok(containers) if containers.is_empty() => {
            println!(
                "  {}",
                dim.apply_to(format!(
                    "no containers for project {} — start the stack with `just run_local`",
                    instance.project_name()
                ))
            );
        }
        Ok(containers) => {
            println!("  {}", dim.apply_to("containers"));
            let name_width = containers.iter().map(|c| c.name.len()).max().unwrap_or(0);
            for c in &containers {
                let dot = if c.running { &up } else { &down };
                let ports = c
                    .host_ports
                    .iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                println!(
                    "  {dot} {:<name_width$}  {:<12} {}",
                    c.name,
                    ports,
                    dim.apply_to(&c.status)
                );
            }
        }
        Err(e) => println!(
            "  {}",
            dim.apply_to(format!("containers unavailable: {e:#}"))
        ),
    }
    println!();

    let generated_env = instance.artifact_dir().join("local.generated.env");
    if generated_env.exists() {
        println!(
            "  {}{}",
            dim.apply_to(format!("{:<16}", "logs")),
            summary::logs_command(instance, &generated_env)
        );
    }
    println!(
        "  {}{}",
        dim.apply_to(format!("{:<16}", "stop")),
        summary::stop_command(instance)
    );
    println!();
    Ok(())
}
