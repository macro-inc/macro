use super::*;

use std::process::Command;

#[test]
fn a_held_lock_is_seen_by_others_and_released_with_its_holder() {
    let dir = std::env::temp_dir().join(format!("supervisor-lock-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("job.lock");

    assert!(!is_locked(&path), "a missing lock file means no holder");
    let held = try_lock(&path).unwrap().expect("nothing holds it yet");
    assert!(is_locked(&path));
    assert!(try_lock(&path).unwrap().is_none());

    drop(held);
    assert!(!is_locked(&path));
    assert!(try_lock(&path).unwrap().is_some());
    std::fs::remove_dir_all(&dir).unwrap();
}

/// This is what survives a harness killing the caller's process tree: the child
/// is no longer in the tree, and has left the caller's session.
#[test]
fn a_detached_process_leaves_the_callers_tree_and_session() {
    let dir = std::env::temp_dir().join(format!("supervisor-detach-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let fifo = dir.join("report");
    assert!(
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );

    // /proc rather than ps, which minimal CI images don't ship.
    let script = format!("cat /proc/$$/stat > {}; exec 0<&-", fifo.display());
    spawn_detached(
        Path::new("sh"),
        &["-c".to_owned(), script],
        &dir.join("out.log"),
    )
    .unwrap();

    // Blocks until the detached process writes, so no polling.
    let stat = std::fs::read_to_string(&fifo).unwrap();
    // pid (comm) state ppid pgrp session ...; comm is `sh`, so no spaces in it.
    let fields: Vec<&str> = stat.split_whitespace().collect();
    let parse = |index: usize| -> u32 {
        fields
            .get(index)
            .and_then(|field| field.parse().ok())
            .unwrap_or_else(|| panic!("unexpected stat: {stat}"))
    };
    let (pid, parent, session) = (parse(0), parse(3), parse(5));
    assert_ne!(parent, std::process::id());
    assert_eq!(session, pid, "it must lead its own session");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn starting_keeps_a_healthy_stack_and_only_fresh_replaces_it() {
    use stack::Phase;

    assert_eq!(
        decide_start(Phase::Ready, false, false),
        StartDecision::AlreadyRunning
    );
    assert_eq!(
        decide_start(Phase::Ready, false, true),
        StartDecision::Spawn
    );
    assert_eq!(
        decide_start(Phase::Starting, true, false),
        StartDecision::AttachToJob
    );
    assert_eq!(
        decide_start(Phase::Starting, true, true),
        StartDecision::Spawn
    );
    for phase in [
        Phase::Stopped,
        Phase::Failed,
        Phase::Degraded,
        Phase::Unrecorded,
    ] {
        assert_eq!(decide_start(phase, false, false), StartDecision::Spawn);
    }
    // A rebuild recreating the backend looks degraded; it must not be interrupted.
    assert_eq!(
        decide_start(Phase::Degraded, true, false),
        StartDecision::AttachToJob
    );
}

#[test]
fn the_innermost_failed_step_is_named_even_when_its_parent_fails_too() {
    let mut record = JobRecord::new(JobKind::Up, None);
    record.step_started("Rebuilding & reloading services");
    record.step_started("Building service binaries");
    record.step_failed("Building service binaries");
    record.step_failed("Rebuilding & reloading services");

    assert_eq!(
        record.failed_step.as_deref(),
        Some("Building service binaries")
    );
    assert!(
        record
            .describe_failure()
            .contains("'Building service binaries'")
    );
}

/// The trace collector failing is best effort: the run carries on, so a later
/// failure must not be blamed on it.
#[test]
fn a_tolerated_failure_is_forgotten_when_the_next_step_starts() {
    let mut record = JobRecord::new(JobKind::Up, None);
    record.step_started("Starting lgtm trace collector");
    record.step_failed("Starting lgtm trace collector");
    record.step_started("Running migrations");
    record.step_failed("Running migrations");

    assert_eq!(record.failed_step.as_deref(), Some("Running migrations"));
}

#[test]
fn only_the_static_flag_turns_vite_off_and_sharing_serves_a_bundle_too() {
    let plain = plan_for(
        Mode::Local,
        &RunLocalFlags::default(),
        &RunArgs::default(),
        Start::Resume,
    );
    assert!(plain.vite && !plain.static_bundle && !plain.share_app);

    let static_frontend = plan_for(
        Mode::Local,
        &RunLocalFlags {
            static_frontend: true,
            ..Default::default()
        },
        &RunArgs::default(),
        Start::Resume,
    );
    assert!(!static_frontend.vite && static_frontend.static_bundle);

    let shared = plan_for(
        Mode::Local,
        &RunLocalFlags::default(),
        &RunArgs {
            with_cf_tunnel: true,
            ..Default::default()
        },
        Start::Fresh,
    );
    assert!(shared.vite && shared.static_bundle && shared.share_app);
}

/// An error raised between steps must not be pinned on the step that succeeded
/// just before it.
#[test]
fn an_error_between_steps_is_placed_after_the_last_step() {
    let mut record = JobRecord::new(JobKind::Up, None);
    record.step_started("Waiting for backend (proxy /auth/health)");

    assert!(
        record
            .describe_failure()
            .contains("failed after 'Waiting for backend (proxy /auth/health)'")
    );
}
