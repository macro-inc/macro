use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::process::{Child, ChildStdout, Command, Stdio};

use super::*;
use crate::layout::{WINDOW_START, hashed_window};
use crate::machine::{Container, Network};
use crate::net::Ipv4Range;

const ALL_BINDABLE: fn(u16) -> bool = |_| true;

/// Set on a re-run of this test binary to make [`child_process`] act instead of
/// returning at once.
const CHILD_ROLE: &str = "XTASK_PORTS_TEST_CHILD";
const CHILD_DIR: &str = "XTASK_PORTS_TEST_DIR";
const CHILD_NAME: &str = "XTASK_PORTS_TEST_NAME";

fn request(name: &str, window: Window) -> Request<'_> {
    Request {
        name,
        own_networks: BTreeSet::new(),
        window,
    }
}

fn allocate(registry: &Registry, name: &str, machine: &Machine) -> Allocation {
    registry
        .lock()
        .unwrap()
        .allocate(&request(name, Window::Any), machine, &ALL_BINDABLE)
        .unwrap()
}

/// A name, other than `name`, whose search starts where `name`'s does.
fn name_sharing(name: &str, key: impl Fn(&str) -> u32) -> String {
    (0..)
        .map(|index| format!("other-{index}"))
        .find(|other| key(other) == key(name))
        .unwrap()
}

fn block_hash(name: &str) -> u32 {
    crate::layout::fnv1a(name) % crate::layout::SUBNET_BLOCKS
}

fn window_hash(name: &str) -> u32 {
    u32::from(hashed_window(name))
}

/// The pid of a process that has exited and been reaped.
fn dead_pid() -> u32 {
    let mut child = Command::new(std::env::current_exe().unwrap())
        .arg("--list")
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let pid = child.id();
    child.wait().unwrap();
    pid
}

/// The entry point of a child process: holds a port, or allocates in a shared
/// registry, and reports on stdout. A no-op in a normal test run.
#[test]
fn child_process() {
    let Some(role) = macro_env_var::maybe_read_env(CHILD_ROLE) else {
        return;
    };
    match role.as_str() {
        "hold" => {
            let listener = TcpListener::bind("0.0.0.0:0").unwrap();
            println!("\nPORT={}", listener.local_addr().unwrap().port());
            // Hold the port until the parent closes stdin.
            std::io::stdin().read_to_end(&mut Vec::new()).unwrap();
        }
        "allocate" => {
            let registry = Registry::at(macro_env_var::maybe_read_env(CHILD_DIR).unwrap());
            let name = macro_env_var::maybe_read_env(CHILD_NAME).unwrap();
            println!("\nREADY");
            let allocation = allocate(&registry, &name, &Machine::default());
            println!(
                "\nALLOCATED {} {}",
                allocation.port_base, allocation.subnet_block
            );
        }
        other => panic!("unknown child role {other}"),
    }
}

struct ChildProcess {
    child: Child,
    stdout: BufReader<ChildStdout>,
}

impl ChildProcess {
    fn spawn(role: &str, env: &[(&str, &str)]) -> Self {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "registry::test::child_process",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD_ROLE, role)
            .envs(env.iter().copied())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        ChildProcess { child, stdout }
    }

    /// Block until the child prints a line starting with `prefix`; the rest of it.
    fn read(&mut self, prefix: &str) -> String {
        let mut line = String::new();
        loop {
            line.clear();
            assert_ne!(
                self.stdout.read_line(&mut line).unwrap(),
                0,
                "child exited before printing {prefix}"
            );
            if let Some(rest) = line.trim_end().strip_prefix(prefix) {
                return rest.to_string();
            }
        }
    }

    fn finish(mut self) {
        drop(self.child.stdin.take());
        assert!(self.child.wait().unwrap().success());
    }
}

fn parse_allocated(line: &str) -> (u16, u8) {
    let (base, block) = line.trim().split_once(' ').unwrap();
    (base.parse().unwrap(), block.parse().unwrap())
}

/// The lock is what makes a cold parallel start safe: without it, both
/// processes read the same empty registry and pick the same window and block.
#[test]
fn two_processes_starting_at_once_get_different_windows_and_blocks() {
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());
    let dir_env = dir.path().to_str().unwrap();
    // Two names on one hashed window: the collision this exists for.
    assert_eq!(hashed_window("crmgp"), hashed_window("synoet-routines-vis"));

    // Hold the lock so both children queue on it, then let them race.
    let held = registry.lock().unwrap();
    let mut first = ChildProcess::spawn("allocate", &[(CHILD_DIR, dir_env), (CHILD_NAME, "crmgp")]);
    let mut second = ChildProcess::spawn(
        "allocate",
        &[(CHILD_DIR, dir_env), (CHILD_NAME, "synoet-routines-vis")],
    );
    first.read("READY");
    second.read("READY");
    drop(held);
    let first_got = parse_allocated(&first.read("ALLOCATED "));
    let second_got = parse_allocated(&second.read("ALLOCATED "));
    first.finish();
    second.finish();

    assert_ne!(first_got.0, second_got.0);
    assert_ne!(first_got.1, second_got.1);
    assert_eq!(
        BTreeSet::from([first_got.0, second_got.0]),
        BTreeSet::from([30_400, 30_500])
    );
    let entries = read_entries(dir.path());
    assert_eq!(entries["crmgp"].port_base, first_got.0);
    assert_eq!(entries["synoet-routines-vis"].port_base, second_got.0);
}

/// Threads in one process open the lock file separately, so they contend like
/// processes do; sixteen at once all get distinct windows.
#[test]
fn sixteen_concurrent_starts_on_one_window_get_distinct_windows() {
    let dir = tempfile::tempdir().unwrap();
    // Sixteen names that all hash to one window.
    let names: Vec<String> = (0..)
        .map(|index| format!("start-{index}"))
        .filter(|name| hashed_window(name) == hashed_window("crmgp"))
        .take(16)
        .collect();
    let starts: Vec<_> = names
        .into_iter()
        .map(|name| {
            let registry = Registry::at(dir.path());
            std::thread::spawn(move || allocate(&registry, &name, &Machine::default()))
        })
        .collect();

    let allocations: Vec<Allocation> = starts
        .into_iter()
        .map(|start| start.join().unwrap())
        .collect();

    let bases: BTreeSet<u16> = allocations.iter().map(|a| a.port_base).collect();
    let blocks: BTreeSet<u8> = allocations.iter().map(|a| a.subnet_block).collect();
    assert_eq!(bases.len(), 16);
    assert_eq!(blocks.len(), 16);
    assert_eq!(read_entries(dir.path()).len(), 16);
}

#[test]
fn an_unreadable_registry_is_empty_rather_than_blocking_every_start() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(REGISTRY_FILE), "not json").unwrap();

    assert!(read_entries(dir.path()).is_empty());
    let allocation = allocate(&Registry::at(dir.path()), "agent-a", &Machine::default());
    assert_eq!(allocation.port_base, hashed_window("agent-a"));
}

#[test]
fn only_a_dead_owner_is_reported_gone() {
    assert!(process_alive(std::process::id()));
    assert!(!process_alive(dead_pid()));
    assert!(!process_alive(u32::MAX));
}

fn seed(dir: &Path, name: &str, port_base: u16, subnet_block: u8, owner_pid: u32) {
    let mut entries = read_entries(dir);
    entries.insert(
        name.to_string(),
        Allocation {
            port_base,
            subnet_block,
            owner_pid,
        },
    );
    write_entries(dir, &entries).unwrap();
}

/// A start that died mid-build leaves a record and nothing in Docker; the next
/// start takes its window back.
#[test]
fn a_dead_owners_record_with_nothing_in_docker_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    seed(
        dir.path(),
        "crashed",
        hashed_window("agent-a"),
        3,
        dead_pid(),
    );

    let allocation = allocate(&Registry::at(dir.path()), "agent-a", &Machine::default());

    assert_eq!(allocation.port_base, hashed_window("agent-a"));
    assert!(!read_entries(dir.path()).contains_key("crashed"));
}

/// A record whose owner is still running is a start mid-build: Docker shows
/// nothing of it yet, so the record alone holds its window.
#[test]
fn a_live_owners_record_holds_its_window_and_block() {
    let dir = tempfile::tempdir().unwrap();
    let hashed_block = choose_block("agent-a", None, &[], &BTreeSet::new()).unwrap();
    seed(
        dir.path(),
        "building",
        hashed_window("agent-a"),
        hashed_block,
        std::process::id(),
    );

    let allocation = allocate(&Registry::at(dir.path()), "agent-a", &Machine::default());

    assert_ne!(allocation.port_base, hashed_window("agent-a"));
    assert_ne!(allocation.subnet_block, hashed_block);
    assert!(read_entries(dir.path()).contains_key("building"));
}

/// A stopped instance's starter is gone, but its networks still hold its block.
#[test]
fn a_dead_owners_record_is_kept_while_docker_holds_its_instance() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path(), "stopped", 30_400, 3, dead_pid());
    let machine = Machine {
        networks: vec![Network {
            name: "databases-stopped".to_string(),
            owner: Some("stopped".to_string()),
            subnets: Vec::new(),
        }],
        ..Machine::default()
    };

    allocate(&Registry::at(dir.path()), "agent-a", &machine);

    assert!(read_entries(dir.path()).contains_key("stopped"));
}

/// Teardown releases the record, and with it the window and block, for the
/// next instance whose search starts there.
#[test]
fn a_released_window_and_block_go_to_the_next_start() {
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());
    let machine = Machine::default();
    let first = allocate(&registry, "agent-a", &machine);
    let same_window = name_sharing("agent-a", window_hash);
    let same_block = name_sharing("agent-a", block_hash);

    let while_held = allocate(&registry, &same_window, &machine);
    assert_ne!(while_held.port_base, first.port_base);
    registry.lock().unwrap().release("agent-a").unwrap();
    registry.lock().unwrap().release(&same_window).unwrap();

    assert!(read_entries(dir.path()).is_empty());
    assert_eq!(
        allocate(&registry, &same_window, &machine).port_base,
        first.port_base
    );
    assert_eq!(
        allocate(&registry, &same_block, &machine).subnet_block,
        first.subnet_block
    );
}

#[test]
fn releasing_an_unknown_instance_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());
    allocate(&registry, "agent-a", &Machine::default());

    registry.lock().unwrap().release("never-started").unwrap();

    assert!(read_entries(dir.path()).contains_key("agent-a"));
}

/// The recheck after a build is the same call: nothing changed, nothing moves.
#[test]
fn the_post_build_recheck_keeps_an_untouched_allocation() {
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());

    let before = allocate(&registry, "agent-a", &Machine::default());
    let after = allocate(&registry, "agent-a", &Machine::default());

    assert_eq!(before, after);
    assert_eq!(read_entries(dir.path()).len(), 1);
}

/// A program outside this tooling took a port of the window during the build:
/// the recheck moves the window and keeps the block, and a pinned window fails.
#[test]
fn the_post_build_recheck_moves_off_a_port_taken_during_the_build() {
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());
    let before = allocate(&registry, "agent-a", &Machine::default());
    let taken = before.port_base + Port::Proxy.offset();
    let bindable = move |port: u16| port != taken;

    let after = registry
        .lock()
        .unwrap()
        .allocate(
            &request("agent-a", Window::Any),
            &Machine::default(),
            &bindable,
        )
        .unwrap();
    let pinned = registry.lock().unwrap().allocate(
        &request("agent-a", Window::Pinned(before.port_base)),
        &Machine::default(),
        &bindable,
    );

    assert_ne!(after.port_base, before.port_base);
    assert_eq!(after.subnet_block, before.subnet_block);
    assert!(matches!(
        pinned,
        Err(AllocateError::PinnedWindowBusy { blocker: WindowBlocker::Port(port), .. }) if port == taken
    ));
}

/// A real listener in another process, on a port the OS picked: the window
/// holding it is skipped and a pin on it fails, whatever else the box runs.
#[test]
fn a_port_another_process_listens_on_blocks_its_window() {
    let mut holder = ChildProcess::spawn("hold", &[]);
    let held: u16 = holder.read("PORT=").parse().unwrap();
    let base = held - Port::Proxy.offset();
    // The real probe on the held port; every other port reads free, so the
    // result doesn't depend on what else this machine runs.
    let bindable = move |port: u16| port != held || crate::probe::bindable(port);
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());
    seed(dir.path(), "agent-a", base, 9, std::process::id());

    let moved = registry
        .lock()
        .unwrap()
        .allocate(
            &request("agent-a", Window::Any),
            &Machine::default(),
            &bindable,
        )
        .unwrap();
    let pinned = registry.lock().unwrap().allocate(
        &request("agent-b", Window::Pinned(base)),
        &Machine::default(),
        &bindable,
    );
    holder.finish();

    assert_ne!(moved.port_base, base);
    assert_eq!(moved.port_base, hashed_window("agent-a"));
    assert!(matches!(
        pinned,
        Err(AllocateError::PinnedWindowBusy { blocker: WindowBlocker::Port(port), .. }) if port == held
    ));
}

/// Docker is the source of truth for existing instances: one keeps the window
/// its containers bind, even off the stride, with no registry record at all.
#[test]
fn an_existing_instance_keeps_its_containers_window() {
    let dir = tempfile::tempdir().unwrap();
    let machine = Machine {
        containers: vec![Container {
            owner: Some("agent-a".to_string()),
            running: true,
            published: Port::all().map(|port| 41_600 + port.offset()).collect(),
        }],
        windows: BTreeMap::from([("agent-a".to_string(), 41_600)]),
        ..Machine::default()
    };
    let bindable = |port: u16| !(41_600..41_650).contains(&port);

    let allocation = Registry::at(dir.path())
        .lock()
        .unwrap()
        .allocate(&request("agent-a", Window::Any), &machine, &bindable)
        .unwrap();

    assert_eq!(allocation.port_base, 41_600);
}

/// Another instance's containers claim their window even with no record.
#[test]
fn another_instances_containers_claim_their_window() {
    let dir = tempfile::tempdir().unwrap();
    let machine = Machine {
        windows: BTreeMap::from([("other".to_string(), hashed_window("agent-a"))]),
        ..Machine::default()
    };

    let allocation = allocate(&Registry::at(dir.path()), "agent-a", &machine);

    assert_ne!(allocation.port_base, hashed_window("agent-a"));
}

#[test]
fn a_block_overlapping_a_live_network_or_route_is_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let hashed = choose_block("agent-a", None, &[], &BTreeSet::new()).unwrap();
    let machine = Machine {
        networks: vec![Network {
            name: "someone-elses".to_string(),
            owner: None,
            subnets: vec![Ipv4Range::parse(&format!("10.254.{hashed}.0/26")).unwrap()],
        }],
        routes: vec![Ipv4Range::parse(&format!("10.254.{}.0/24", hashed.wrapping_add(1))).unwrap()],
        ..Machine::default()
    };

    let allocation = allocate(&Registry::at(dir.path()), "agent-a", &machine);

    assert_eq!(allocation.subnet_block, hashed.wrapping_add(2));
}

/// An instance's own networks don't push it off its block on restart.
#[test]
fn an_instance_keeps_its_block_through_its_own_networks() {
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());
    let first = allocate(&registry, "agent-a", &Machine::default());
    let machine = Machine {
        networks: vec![Network {
            name: "databases-agent-a".to_string(),
            owner: Some("agent-a".to_string()),
            subnets: vec![
                Ipv4Range::parse(&crate::layout::network_subnet(first.subnet_block, 0)).unwrap(),
            ],
        }],
        ..Machine::default()
    };
    let own = Request {
        name: "agent-a",
        own_networks: BTreeSet::from(["databases-agent-a".to_string()]),
        window: Window::Any,
    };

    let again = registry
        .lock()
        .unwrap()
        .allocate(&own, &machine, &ALL_BINDABLE)
        .unwrap();

    assert_eq!(again.subnet_block, first.subnet_block);
}

#[test]
fn the_default_instance_fails_early_when_a_fixed_port_is_taken() {
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());
    let bindable = |port: u16| port != Port::Postgres.fixed();
    let fixed = |check_free| {
        request(
            DEFAULT_INSTANCE,
            Window::Fixed {
                base: hashed_window(DEFAULT_INSTANCE),
                check_free,
            },
        )
    };

    let checked = registry
        .lock()
        .unwrap()
        .allocate(&fixed(true), &Machine::default(), &bindable);
    let unchecked =
        registry
            .lock()
            .unwrap()
            .allocate(&fixed(false), &Machine::default(), &bindable);

    assert_eq!(
        checked.unwrap_err().to_string(),
        "ports 5432 are in use, and the default instance's ports are fixed. Use a named \
         instance, which gets a free window: --instance <name>"
    );
    assert!(unchecked.is_ok());
}

/// The default instance's own containers on its fixed ports aren't a conflict,
/// and the frontend port isn't checked (headless stacks don't start Vite).
#[test]
fn the_default_instance_may_hold_its_own_fixed_ports() {
    let dir = tempfile::tempdir().unwrap();
    let machine = Machine {
        containers: vec![Container {
            owner: Some(DEFAULT_INSTANCE.to_string()),
            running: true,
            published: vec![Port::Postgres.fixed()],
        }],
        ..Machine::default()
    };
    let bindable = |port: u16| port != Port::Postgres.fixed() && port != Port::Frontend.fixed();

    let allocation = Registry::at(dir.path()).lock().unwrap().allocate(
        &request(
            DEFAULT_INSTANCE,
            Window::Fixed {
                base: 1,
                check_free: true,
            },
        ),
        &machine,
        &bindable,
    );

    assert_eq!(allocation.unwrap().port_base, 1);
}

/// The default instance's record never claims a window: its ports are fixed.
#[test]
fn the_default_instances_record_claims_no_window() {
    let dir = tempfile::tempdir().unwrap();
    seed(
        dir.path(),
        DEFAULT_INSTANCE,
        hashed_window("agent-a"),
        200,
        std::process::id(),
    );

    let allocation = allocate(&Registry::at(dir.path()), "agent-a", &Machine::default());

    assert_eq!(allocation.port_base, hashed_window("agent-a"));
}

#[test]
fn a_full_machine_names_whats_left_over() {
    let dir = tempfile::tempdir().unwrap();
    let windows: BTreeMap<String, u16> = (0..crate::layout::BUCKETS)
        .map(|bucket| {
            (
                format!("i{bucket}"),
                (WINDOW_START + bucket * crate::layout::STRIDE) as u16,
            )
        })
        .collect();
    let machine = Machine {
        windows,
        containers: vec![Container {
            owner: Some("old".to_string()),
            running: false,
            published: Vec::new(),
        }],
        ..Machine::default()
    };

    let error = Registry::at(dir.path())
        .lock()
        .unwrap()
        .allocate(&request("agent-a", Window::Any), &machine, &ALL_BINDABLE)
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "no free port windows on this machine: 0 instances running; stopped: old; networks \
         only: none. Check one is unused, then `just destroy_local --instance <name>` frees it"
    );
}

#[test]
fn a_recorded_allocation_reads_back_without_the_lock() {
    let dir = tempfile::tempdir().unwrap();
    let registry = Registry::at(dir.path());
    let allocation = allocate(&registry, "agent-a", &Machine::default());

    assert_eq!(registry.recorded("agent-a"), Some(allocation));
    assert_eq!(registry.recorded("agent-b"), None);
}
