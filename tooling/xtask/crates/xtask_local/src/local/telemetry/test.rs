use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde_json::json;
use xtask_local_telemetry::{Event, Paths};

use super::super::instance::Instance;
use super::{
    BuildOutput, CargoUnit, RunKind, RunTelemetry, SccacheStats, ServiceHealth,
    fresh_cargo_timings, parse_cargo_timings, parse_cpuinfo_model, parse_meminfo_kib, step_name,
};

/// A `stop` exits as soon as it returns, so its run line must already be
/// buffered then, or the next run reports the stop as interrupted.
/// Opt in at a closed local port, so lines stay in the buffer to be read back.
fn opted_in(dir: &std::path::Path) -> Paths {
    let closed = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = closed.local_addr().expect("addr").port();
    drop(closed);
    let config = dir.join("local-telemetry.toml");
    std::fs::write(&config, format!("endpoint = \"http://127.0.0.1:{port}\"\n")).expect("write");
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o600)).expect("chmod");
    Paths::at(config, dir.join("buffer"))
}

fn buffered_records(paths: &Paths) -> Vec<serde_json::Value> {
    let buffered: String = std::fs::read_dir(&paths.buffer_dir)
        .expect("buffer dir")
        .filter_map(|entry| std::fs::read_to_string(entry.ok()?.path()).ok())
        .collect();
    buffered
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

#[test]
fn an_action_buffers_its_run_event_before_returning() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = opted_in(dir.path());
    let instance = Instance::derive(Some("telemetry-test"), None).expect("instance");

    let telemetry = RunTelemetry::begin_in(
        &paths,
        Some(&instance),
        RunKind::Stop,
        SystemTime::now(),
        false,
    );
    assert!(telemetry.is_some());
    RunTelemetry::finish_action(telemetry, || Ok(())).expect("action");

    let run = buffered_records(&paths)
        .into_iter()
        .find(|line| line["event"] == json!("run"))
        .expect("a buffered run event");
    assert_eq!(run["fields"]["outcome"], json!("success"));
    let begin = buffered_records(&paths)
        .into_iter()
        .find(|line| line["line"] == json!("begin"))
        .expect("a begin line");
    // A named instance's name is chosen by a person: only its hash is sent.
    assert_ne!(begin["common"]["instance"], json!("telemetry-test"));
    assert_eq!(begin["common"]["instance_kind"], json!("named"));
}

/// A rebuild can close while its build lane is still reading sccache's
/// counters; closing waits for the lane, so the build line is not dropped.
#[test]
fn a_rebuild_keeps_the_build_its_lane_records_after_close() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = opted_in(dir.path());
    let instance = Instance::derive(Some("telemetry-test"), None).expect("instance");
    let telemetry = RunTelemetry::begin_in(
        &paths,
        Some(&instance),
        RunKind::Rebuild,
        SystemTime::now(),
        false,
    )
    .expect("on");

    let shared = Arc::clone(&telemetry.shared);
    let lane = std::thread::spawn(move || {
        // Stands in for a slow `sccache --show-stats`.
        std::thread::sleep(Duration::from_millis(200));
        shared.record(Event::new("build"));
    });
    telemetry.shared.state().lanes.push(lane);
    telemetry.finish(true, None, Duration::ZERO);

    let events: Vec<_> = buffered_records(&paths)
        .into_iter()
        .filter_map(|line| line["event"].as_str().map(str::to_owned))
        .collect();
    assert!(events.iter().any(|event| event == "build"), "{events:?}");
}

/// A command without a job (`build-services`) records through its stage, and
/// its run event names the step that failed.
#[test]
fn a_stage_without_a_job_records_its_steps_and_failure() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = opted_in(dir.path());
    let telemetry = RunTelemetry::begin_in(
        &paths,
        None,
        RunKind::BuildServices,
        SystemTime::now(),
        false,
    );
    assert!(telemetry.is_some());
    let stage = super::super::stage::Stage::from_env().with_telemetry(telemetry.clone());

    let result = stage
        .run_step("Resolving binaries", || Ok(()))
        .and_then(|()| stage.run_step("Linking", || anyhow::bail!("linker exploded")));
    RunTelemetry::close(telemetry, &result);

    let records = buffered_records(&paths);
    let steps: Vec<_> = records
        .iter()
        .filter(|line| line["event"] == json!("step"))
        .map(|line| line["fields"]["step"].clone())
        .collect();
    assert_eq!(steps, vec![json!("Resolving binaries"), json!("Linking")]);
    let run = records
        .iter()
        .find(|line| line["event"] == json!("run"))
        .expect("a buffered run event");
    assert_eq!(run["fields"]["outcome"], json!("failure"));
    assert_eq!(run["fields"]["failed_step"], json!("Linking"));
    let begin = records
        .iter()
        .find(|line| line["line"] == json!("begin"))
        .expect("a begin line");
    assert_eq!(begin["common"]["kind"], json!("build_services"));
    assert!(begin["common"].get("instance").is_none());
}

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
    assert_eq!(
        step_name("Saving init snapshot (9b59c964b276)"),
        "Saving init snapshot"
    );
    assert_eq!(
        step_name("Restoring init snapshot (9b59c964b276)"),
        "Restoring init snapshot"
    );
    assert_eq!(
        step_name("Building runtime image macro-local-runtime:7a3bece74a68"),
        "Building runtime image"
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
            workspace_crates: ["macro_db_client", "email_service"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
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

/// `2026-11-08T10:00:00Z`, when [`container`] started.
const STARTED_AT_UNIX: u64 = 1_794_132_000;

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
            started: Some(SystemTime::UNIX_EPOCH + Duration::from_secs(STARTED_AT_UNIX)),
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

/// A step started inside another on the same thread is its child span; a
/// background lane's steps are top-level spans in their own lane.
#[test]
fn nested_steps_name_their_parent_and_lanes_keep_their_own() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = opted_in(dir.path());
    let telemetry = RunTelemetry::begin_in(
        &paths,
        None,
        RunKind::BuildServices,
        SystemTime::now(),
        false,
    );
    let stage = super::super::stage::Stage::from_env().with_telemetry(telemetry.clone());
    let background = stage.background(super::FRONTEND_LANE);

    let lane =
        std::thread::spawn(move || background.run_step("Building frontend bundle", || Ok(())));
    let result = stage.run_step("Building the Macro computer image", || {
        stage
            .quiet()
            .run_step("Loading the image into Docker", || Ok(()))
    });
    lane.join().expect("lane").expect("lane step");
    RunTelemetry::close(telemetry, &result);

    let records = buffered_records(&paths);
    let step = |name: &str| {
        records
            .iter()
            .find(|line| line["event"] == json!("step") && line["fields"]["step"] == json!(name))
            .unwrap_or_else(|| panic!("a step event for {name}"))
            .clone()
    };
    let outer = step("Building the Macro computer image");
    let inner = step("Loading the image into Docker");
    let frontend = step("Building frontend bundle");

    assert_eq!(inner["parent"], outer["span"]);
    assert_eq!(
        inner["fields"]["parent_step"],
        json!("Building the Macro computer image")
    );
    assert!(outer.get("parent").is_none(), "{outer}");
    assert_eq!(outer["fields"]["lane"], json!("main"));
    assert_eq!(inner["fields"]["lane"], json!("main"));
    assert_eq!(frontend["fields"]["lane"], json!("frontend"));
    assert!(frontend.get("parent").is_none(), "{frontend}");
    assert!(outer["fields"][super::OFFSET_FIELD].as_f64().is_some());
    assert_ne!(outer["span"], frontend["span"]);
}

#[test]
fn cargo_timings_keep_the_slowest_units() {
    let html = r#"<script>
const UNIT_DATA = [
  { "i": 1, "name": "serde", "version": "1.0.0", "mode": "todo", "target": "",
    "features": [], "start": 0.1, "duration": 0.4, "unblocked_units": [],
    "unblocked_rmeta_units": [], "sections": null },
  { "i": 2, "name": "email_service", "version": "0.1.0", "mode": "todo",
    "target": " bin \"email_service\"", "features": [], "start": 30.0,
    "duration": 12.5, "unblocked_units": [], "unblocked_rmeta_units": [], "sections": null },
  { "i": 3, "name": "ring", "version": "0.17.0", "mode": "run-custom-build",
    "target": " build script (run)", "features": [], "start": 2.0, "duration": 6.0,
    "unblocked_units": [], "unblocked_rmeta_units": [], "sections": null }
];
const CONCURRENCY_DATA = [];
</script>"#;
    let units = parse_cargo_timings(html);
    assert_eq!(
        units
            .iter()
            .map(|unit| (unit.name.as_str(), unit.target_kind()))
            .collect::<Vec<_>>(),
        vec![("email_service", "bin"), ("ring", "build-script-run")]
    );
    assert_eq!(
        parse_cargo_timings("<html></html>"),
        Vec::<CargoUnit>::new()
    );
}

#[test]
fn hardware_fields_parse_proc() {
    assert_eq!(
        parse_meminfo_kib("MemTotal:       65843160 kB\nMemFree:  1 kB\n"),
        Some(65_843_160)
    );
    assert_eq!(
        parse_cpuinfo_model(
            "processor\t: 0\nvendor_id\t: AuthenticAMD\nmodel name\t: AMD EPYC 7B13\n"
        ),
        Some("AMD EPYC 7B13".to_owned())
    );
    assert_eq!(parse_cpuinfo_model("processor\t: 0\n"), None);
}

/// A ready bring-up names its start, trace and machine in one field, which the
/// dashboard's run pickers list; other runs don't.
#[test]
fn a_ready_bring_up_carries_its_picker_key() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = opted_in(dir.path());
    let instance = Instance::derive(Some("telemetry-test"), None).expect("instance");
    let telemetry = RunTelemetry::begin_in(
        &paths,
        Some(&instance),
        RunKind::Up,
        SystemTime::now(),
        false,
    )
    .expect("on");
    telemetry.shared.state().shape =
        std::collections::BTreeMap::from([("start".to_owned(), json!("resume"))]);
    telemetry.finish(true, None, Duration::from_secs(5));

    let records = buffered_records(&paths);
    let run = records
        .iter()
        .find(|line| line["event"] == json!("run"))
        .expect("a buffered run event");
    let key = run["fields"]["bring_up"].as_str().expect("a bring_up key");
    let parts: Vec<&str> = key.split('/').collect();
    assert_eq!(parts.first(), Some(&"resume"));
    let run_id = parts.get(1).expect("a run id");
    assert!(run_id.len() == 32 && run_id.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert!(parts.get(2).is_some_and(|machine| !machine.is_empty()));
}

#[test]
fn reading_a_build_report_removes_the_copy_cargo_kept_of_it() {
    let dir = tempfile::tempdir().expect("tempdir");
    let older = dir.path().join("cargo-timing-20200101T000000Z.html");
    std::fs::write(&older, "").expect("write older report");
    // File times are coarser than the clock: start the build a second back.
    let since = SystemTime::now()
        .checked_sub(Duration::from_secs(1))
        .expect("time");
    let ours = dir.path().join("cargo-timing-20990101T000000Z.html");
    let report = dir.path().join("cargo-timing.html");
    let html = r#"<script>
const UNIT_DATA = [
  { "i": 1, "name": "serde", "version": "1.0.0", "mode": "todo", "target": "",
    "features": [], "start": 0.1, "duration": 4.0, "unblocked_units": [],
    "unblocked_rmeta_units": [], "sections": null }
];
const CONCURRENCY_DATA = [];
</script>"#;
    std::fs::write(&ours, html).expect("write report");
    std::fs::hard_link(&ours, &report).expect("link report");
    // A report written before the build began is kept, even if its clock
    // says otherwise.
    let earlier = since.checked_sub(Duration::from_secs(60)).expect("time");
    std::fs::File::options()
        .write(true)
        .open(&older)
        .and_then(|file| file.set_modified(earlier))
        .expect("age the older report");

    let units = fresh_cargo_timings(&report, since);

    assert_eq!(units.len(), 1);
    assert!(report.exists());
    assert!(!ours.exists());
    assert!(older.exists());
}
