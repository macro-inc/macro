use serde_json::json;

use super::{BuildOutput, SccacheStats, ServiceHealth, step_name};

#[test]
fn labels_with_names_become_one_step() {
    assert_eq!(step_name("Stopping macro-agent-a"), "Stopping stack");
    assert_eq!(
        step_name("Reloading document_storage_service, email_service"),
        "Reloading services"
    );
    assert_eq!(
        step_name("Building sandbox image macro-sandbox:3f2a9c"),
        "Building sandbox image"
    );
    assert_eq!(step_name("Running migrations"), "Running migrations");
}

#[test]
fn build_output_counts_compiled_units_and_ours() {
    let output = b"   Compiling serde v1.0.219\n\
        \x20  Compiling macro_db_client v0.1.0 (/repo/crates/macro_db_client)\n\
        warning: unused import\n\
        \x20  Compiling email_service v0.1.0 (/repo/services/email_service)\n\
        \x20   Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 02s\n";
    assert_eq!(
        BuildOutput::parse(output),
        BuildOutput {
            units_compiled: 3,
            workspace_units_compiled: 2,
        }
    );
}

#[test]
fn sccache_counts_sum_every_language() {
    let stats = json!({
        "stats": {
            "compile_requests": 120,
            "cache_hits": { "counts": { "Rust": 90, "C/C++": 4 } },
            "cache_misses": { "counts": { "Rust": 20 } },
        }
    });
    assert_eq!(
        SccacheStats::parse(&stats),
        Some(SccacheStats {
            requests: 120,
            hits: 94,
            misses: 20,
        })
    );
}

fn container(log: serde_json::Value) -> serde_json::Value {
    json!({
        "RestartCount": 1,
        "Config": { "Labels": { "com.docker.compose.service": "postgres" } },
        "State": {
            "StartedAt": "2026-11-08T10:00:00.000000000Z",
            "Health": { "Status": "healthy", "Log": log },
        },
    })
}

#[test]
fn health_wait_runs_to_the_first_passing_probe() {
    let health = ServiceHealth::parse(&container(json!([
        { "Start": "2026-11-08T10:00:01Z", "End": "2026-11-08T10:00:01.500Z", "ExitCode": 1 },
        { "Start": "2026-11-08T10:00:04Z", "End": "2026-11-08T10:00:04.250Z", "ExitCode": 0 },
        { "Start": "2026-11-08T10:00:07Z", "End": "2026-11-08T10:00:07.100Z", "ExitCode": 0 },
    ])));
    assert_eq!(
        health,
        Some(ServiceHealth {
            service: "postgres".to_owned(),
            health: "healthy".to_owned(),
            seconds_to_healthy: Some(4.25),
            restarts: 1,
        })
    );
}

#[test]
fn a_rotated_health_log_of_passes_has_no_wait() {
    let passes: Vec<serde_json::Value> = (1..=5)
        .map(|second| {
            json!({
                "Start": format!("2026-11-08T10:00:{:02}Z", second * 10),
                "End": format!("2026-11-08T10:00:{:02}.1Z", second * 10),
                "ExitCode": 0,
            })
        })
        .collect();
    let health = ServiceHealth::parse(&container(json!(passes))).expect("parsed");
    assert_eq!(health.seconds_to_healthy, None);
}

#[test]
fn a_container_without_a_healthcheck_reports_none() {
    let health = ServiceHealth::parse(&json!({
        "RestartCount": 0,
        "Config": { "Labels": { "com.docker.compose.service": "email_service" } },
        "State": { "StartedAt": "2026-11-08T10:00:00Z" },
    }))
    .expect("parsed");
    assert_eq!(health.health, "none");
    assert_eq!(health.seconds_to_healthy, None);
}
