//! `doctor-local`: preflight checks for tools, toolchain, ports, env, images.

use std::process::Command;

use anyhow::{bail, Result};

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
            }
        }
    };
    let sysroot = match Command::new("rustc").args(["--print", "sysroot"]).output() {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => {
            return Status::Fail {
                msg: "rustc not found".into(),
                hint: None,
            }
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
                "add {} to rust/rust-toolchain.toml `targets` and re-enter `nix develop`",
                target.triple
            )),
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
