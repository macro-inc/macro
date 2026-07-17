//! `doctor-local`: preflight checks for tools, toolchain, ports, env, images.

use std::process::Command;

use anyhow::{Result, bail};

use super::{arch, cli::InstanceArgs, instance::Instance, stage::Stage};

enum Status {
    Ok(String),
    Warn(String),
    Fail { msg: String, hint: Option<String> },
}

/// Run all checks, print results, and fail if any check failed.
pub fn run(args: &InstanceArgs) -> Result<()> {
    let stage = Stage::from_env();
    let instance = Instance::derive(args.instance.as_deref(), args.port_base)?;
    stage.section(&format!("doctor-local — instance {}", instance.name()));

    let checks: Vec<(&str, Status)> = vec![
        ("docker daemon", check_docker()),
        ("docker compose", check_compose()),
        (
            "zig / cargo-zigbuild",
            check_bin(
                "cargo-zigbuild",
                "install cargo-zigbuild + zig (in the nix dev shell)",
            ),
        ),
        (
            "sccache",
            check_bin("sccache", "install sccache (in the nix dev shell)"),
        ),
        (
            "cmake",
            check_bin("cmake", "install cmake (in the nix dev shell)"),
        ),
        ("bun", check_bin("bun", "install bun")),
        (
            "sqlx-cli",
            check_bin("sqlx", "cargo install sqlx-cli (in the nix dev shell)"),
        ),
        ("rust target", check_rust_target()),
        ("ports", check_ports(&instance)),
        ("port forwarding", check_port_forwarding(&instance)),
    ];

    let mut failed = false;
    for (name, status) in &checks {
        match status {
            Status::Ok(detail) => stage.note(&format!("✓ {name}: {detail}")),
            Status::Warn(detail) => stage.note(&format!("! {name}: {detail}")),
            Status::Fail { msg, hint } => {
                failed = true;
                stage.note(&format!("✗ {name}: {msg}"));
                if let Some(h) = hint {
                    stage.note(&format!("    hint: {h}"));
                }
            }
        }
    }
    if failed {
        bail!("doctor-local found problems (see above)");
    }
    stage.note("all checks passed");
    Ok(())
}

fn ok_status(out: &str) -> Status {
    Status::Ok(out.lines().next().unwrap_or("").trim().to_string())
}

fn check_docker() -> Status {
    match Command::new("docker")
        .args(["info", "--format", "{{.ServerVersion}}"])
        .output()
    {
        Ok(o) if o.status.success() => ok_status(&String::from_utf8_lossy(&o.stdout)),
        _ => Status::Fail {
            msg: "cannot reach the Docker daemon".into(),
            hint: Some("start Docker Desktop / colima / orbstack".into()),
        },
    }
}

fn check_compose() -> Status {
    match Command::new("docker")
        .args(["compose", "version", "--short"])
        .output()
    {
        Ok(o) if o.status.success() => ok_status(&String::from_utf8_lossy(&o.stdout)),
        _ => Status::Fail {
            msg: "`docker compose` unavailable".into(),
            hint: Some("install the Docker Compose v2 plugin (>= 2.24.4 for !reset)".into()),
        },
    }
}

fn check_bin(bin: &str, hint: &str) -> Status {
    match Command::new(bin).arg("--version").output() {
        Ok(o) if o.status.success() => ok_status(&String::from_utf8_lossy(&o.stdout)),
        _ => Status::Fail {
            msg: format!("`{bin}` not found"),
            hint: Some(hint.to_string()),
        },
    }
}

fn check_rust_target() -> Status {
    let target = match arch::detect() {
        Ok(t) => t,
        Err(e) => {
            return Status::Fail {
                msg: e.to_string(),
                hint: None,
            };
        }
    };
    let sysroot = match Command::new("rustc").args(["--print", "sysroot"]).output() {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => {
            return Status::Fail {
                msg: "rustc not found".into(),
                hint: None,
            };
        }
    };
    let std_dir = std::path::Path::new(&sysroot)
        .join("lib/rustlib")
        .join(target.triple);
    if std_dir.exists() {
        Status::Ok(target.describe())
    } else {
        Status::Fail {
            msg: format!("rust target {} not installed", target.triple),
            hint: Some(format!(
                "add {} to rust-toolchain.toml `targets` and re-enter `nix develop`",
                target.triple
            )),
        }
    }
}

/// Docker Desktop's VM can wedge so that a container's host port bindings are
/// configured (`HostConfig.PortBindings`) but never activated
/// (`NetworkSettings.Ports` stays empty): the container is healthy inside the
/// VM while nothing on the host can reach it, and health probes hang instead
/// of failing. Only a Docker Desktop restart recovers it.
fn check_port_forwarding(instance: &Instance) -> Status {
    let names: Vec<String> = match Command::new("docker")
        .args([
            "ps",
            "--filter",
            &format!(
                "label=com.docker.compose.project={}",
                instance.project_name()
            ),
            "--format",
            "{{.Names}}",
        ])
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        _ => return Status::Warn("could not list this instance's containers".into()),
    };
    if names.is_empty() {
        return Status::Ok("no running containers for this instance".into());
    }

    let mut cmd = Command::new("docker");
    cmd.args([
        "inspect",
        "--format",
        "{{.Name}}\t{{json .HostConfig.PortBindings}}\t{{json .NetworkSettings.Ports}}",
    ])
    .args(&names);
    let out = match cmd.output() {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return Status::Warn("docker inspect failed".into()),
    };

    let non_empty_array = |v: Option<&serde_json::Value>| -> bool {
        v.and_then(|v| v.as_array()).is_some_and(|a| !a.is_empty())
    };
    let mut wedged: Vec<String> = Vec::new();
    for line in out.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(name), Some(configured), Some(active)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let configured: serde_json::Value = serde_json::from_str(configured).unwrap_or_default();
        let active: serde_json::Value = serde_json::from_str(active).unwrap_or_default();
        let Some(configured) = configured.as_object() else {
            continue;
        };
        for (port, bindings) in configured {
            if non_empty_array(Some(bindings)) && !non_empty_array(active.get(port)) {
                wedged.push(format!("{} {port}", name.trim_start_matches('/')));
            }
        }
    }

    if wedged.is_empty() {
        Status::Ok(format!(
            "{} running container(s) publish their configured ports",
            names.len()
        ))
    } else {
        Status::Fail {
            msg: format!(
                "host bindings configured but inactive: {}",
                wedged.join(", ")
            ),
            hint: Some(
                "Docker Desktop's VM port forwarding is wedged — restart Docker Desktop".into(),
            ),
        }
    }
}

fn check_ports(instance: &Instance) -> Status {
    let busy = instance.busy_ports();
    if busy.is_empty() {
        Status::Ok(format!(
            "all {} ports free",
            super::instance::Port::all().count()
        ))
    } else {
        let list: Vec<String> = busy.iter().map(|p| p.to_string()).collect();
        Status::Warn(format!(
            "in use: {} (may be this instance's own running containers; otherwise pass --port-base)",
            list.join(", ")
        ))
    }
}
