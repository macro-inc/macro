use std::os::fd::IntoRawFd as _;

use super::*;

/// A real child in its own process group, the way `AcpProcess` spawns one,
/// with its three pipes.
fn spawn_child() -> (std::process::Child, HandedOffAgent) {
    use std::os::unix::process::CommandExt as _;

    let mut child = std::process::Command::new("cat")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .process_group(0)
        .spawn()
        .unwrap();
    let pid = Pid::from_raw(i32::try_from(child.id()).unwrap()).unwrap();
    let agent = HandedOffAgent::new(
        pid,
        OwnedFd::from(child.stdin.take().unwrap()),
        OwnedFd::from(child.stdout.take().unwrap()),
        OwnedFd::from(child.stderr.take().unwrap()),
        b"{\"jsonrpc\":\"2.0\",\"method\":\"session/upd".to_vec(),
        vec!["\"agent_session:1:7\"".to_owned()],
    );
    (child, agent)
}

fn is_running(pid: Pid) -> bool {
    matches!(
        rustix::process::waitpid(Some(pid), rustix::process::WaitOptions::NOHANG),
        Ok(None)
    )
}

#[test]
fn state_round_trips_through_the_inherited_descriptor() {
    let (_child, agent) = spawn_child();
    let expected = agent.state();

    let (state_fd, number) = agent.prepare_exec().unwrap();
    assert_eq!(number, state_fd.as_raw_fd().to_string());
    // Survives exec: no FD_CLOEXEC on the state or the pipes.
    for fd in [
        state_fd.as_fd(),
        agent.parts().stdin.as_fd(),
        agent.parts().stdout.as_fd(),
        agent.parts().stderr.as_fd(),
    ] {
        assert_eq!(rustix::io::fcntl_getfd(fd).unwrap(), FdFlags::empty());
    }
    let (state, _) = read_state(std::fs::File::from(state_fd))
        .map_err(|(error, _)| error)
        .unwrap();

    assert_eq!(state, expected);
    // The new image would now own the pipes; release them from this value.
    let parts = agent.into_parts();
    let _ = (
        parts.stdin.into_raw_fd(),
        parts.stdout.into_raw_fd(),
        parts.stderr.into_raw_fd(),
    );
    let adopted = adopt((state, Vec::new()))
        .map_err(|(error, _)| error)
        .unwrap();
    let parts = adopted.into_parts();

    assert_eq!(parts.pid, expected_pid(&expected));
    assert_eq!(
        parts.pending_output,
        b"{\"jsonrpc\":\"2.0\",\"method\":\"session/upd"
    );
    assert_eq!(parts.active_prompts, ["\"agent_session:1:7\""]);
    // Adopted descriptors are close-on-exec again, so later children never
    // inherit them.
    assert_eq!(
        rustix::io::fcntl_getfd(parts.stdin.as_fd()).unwrap(),
        FdFlags::CLOEXEC
    );
    kill_and_reap(parts.pid);
}

fn expected_pid(state: &HandoffState) -> Pid {
    Pid::from_raw(state.agent.pid).unwrap()
}

#[test]
fn an_unknown_format_version_is_refused_but_still_names_the_agent() {
    let raw = br#"{"version": 2, "agent": {"pid": 4242, "stdin": 7, "stdout": 8, "stderr": 9, "sessions": []}}"#;

    let error = parse_state(raw).unwrap_err();
    let fallback = Fallback::from_raw(raw);

    assert!(
        matches!(error, HandoffError::Version { found: 2 }),
        "{error:?}"
    );
    assert_eq!(fallback.pid, Some(4242));
    assert_eq!(fallback.fds, [7, 8, 9]);
}

#[test]
fn malformed_state_is_refused_with_nothing_to_clean_up() {
    let raw = b"not json";

    assert!(matches!(parse_state(raw), Err(HandoffError::Malformed(_))));
    let fallback = Fallback::from_raw(raw);
    assert_eq!(fallback.pid, None);
    assert!(fallback.fds.is_empty());
}

#[test]
fn a_pid_that_is_not_a_running_child_is_refused() {
    let state = HandoffState {
        version: FORMAT_VERSION,
        agent: AgentRecord {
            // pid 1 is never this test's child.
            pid: 1,
            stdin: -1,
            stdout: -1,
            stderr: -1,
            pending_output: String::new(),
            active_prompts: Vec::new(),
        },
    };

    let Err((error, _)) = adopt((state, Vec::new())) else {
        panic!("adopted a process that is not a child");
    };
    assert!(matches!(error, HandoffError::NotAChild(1)), "{error:?}");
}

#[test]
fn an_untaken_handoff_stops_the_agent() {
    // The reaper owns the child's exit status; this test must not wait too.
    let (_child, mut agent) = spawn_child();
    let pid = agent.parts().pid;
    assert!(is_running(pid));

    let reaper = agent.stop().expect("the agent was not taken");

    let status = reaper.join().unwrap().expect("the agent was reaped");
    assert_eq!(status.terminating_signal(), Some(9));
}

#[test]
fn the_fallback_stops_the_agent_it_names() {
    let (_child, agent) = spawn_child();
    let parts = agent.into_parts();
    let raw = serde_json::to_vec(&serde_json::json!({
        "version": 99,
        "agent": {"pid": parts.pid.as_raw_nonzero().get()},
    }))
    .unwrap();

    let reaper = Fallback::from_raw(&raw)
        .kill()
        .expect("the state names a pid");

    // The reaper owns the child's exit status; this test must not wait too.
    let status = reaper.join().unwrap().expect("the agent was reaped");
    assert_eq!(status.terminating_signal(), Some(9));
}
