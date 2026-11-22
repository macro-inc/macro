use super::*;
use lexical_model::{
    Command, CommandKind, CommandListener, CommandPriority, CommandRegistration, Error, Handled,
    KeyEvent, Placement, Transaction, ViewSelection,
};
use std::sync::atomic::AtomicUsize;

fn create_machine(opt_in: bool) -> Machine {
    let config = wire::SessionConfigMsg {
        doc: "listener-metadata-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut machine =
        Machine::create_macro(generated::ABI_MAJOR, &bytes(&config).unwrap(), 0.0, 0.0).unwrap();
    if opt_in {
        let owner = machine.view_commands().unwrap().owner();
        machine.enable_listener_metadata(owner).unwrap();
    }
    machine.sync(SyncInput::Start, 0.0, None).unwrap();
    machine
        .sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )
        .unwrap();
    machine
}
fn machine() -> Machine {
    create_machine(true)
}
fn metadata(packet: &[u8]) -> wire::ViewEffectMsg {
    let word = |at| u32::from_le_bytes(packet[at..at + 4].try_into().unwrap());
    let mut offset = (24 + word(12) as usize * 4 + word(16) as usize + 3) & !3;
    let mut found = None;
    for _ in 0..word(20) {
        let start = offset + 16;
        let end = start + word(offset + 12) as usize;
        if word(offset) == 16 {
            let effect = wire::ViewEffectMsg::deserialize(&packet[start..end]).unwrap();
            if effect.kind == 6 && effect.code == 11 {
                assert!(found.is_none());
                found = Some(effect);
            }
        }
        offset = (end + 3) & !3;
    }
    assert_eq!(offset, packet.len());
    found.expect("one actual metadata effect")
}
fn metadata_start(packet: &[u8]) -> usize {
    let payload = bytes(&metadata(packet)).unwrap();
    packet.len() - 16 - ((payload.len() + 3) & !3)
}
struct All(Arc<AtomicUsize>);
impl CommandListener for All {
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(Handled::Yes)
    }
}
fn register_all(machine: &mut Machine) -> (Arc<AtomicUsize>, lexical_model::CommandListenerId) {
    let Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let calls = Arc::new(AtomicUsize::new(0));
    let id = session.register_command_listener(
        CommandRegistration {
            command: CommandKind::KeyDown,
            priority: CommandPriority::High,
            placement: Placement::After,
        },
        Arc::new(All(calls.clone())),
    );
    (calls, id)
}
fn assert_all(effect: &wire::ViewEffectMsg) {
    let index = effect
        .keys
        .iter()
        .position(|command| command == "KeyDown")
        .unwrap();
    let priorities: Vec<u32> = serde_json::from_str(&effect.style).unwrap();
    assert_eq!(priorities[index] & (1 << CommandPriority::High as u8), 8);
    assert!(effect
        .keys
        .iter()
        .any(|key| key.starts_with("ListenerTableGeneration:1:")));
}

#[test]
fn transfer_snapshots_current_listener_after_input_before_any_output_callback() {
    let mut machine = machine();
    let pending = machine.output.clone();
    let prefix = metadata_start(&machine.output);
    let (calls, _) = register_all(&mut machine);
    let transferred = machine.take_output().unwrap();
    assert_eq!(&pending[..prefix], &transferred[..prefix]);
    assert_all(&metadata(&transferred));
    assert!(machine.take_output().unwrap().is_empty());
    machine
        .editor(
            Input::KeyDown {
                event: KeyEvent {
                    key: "x".into(),
                    ..Default::default()
                },
                selection: ViewSelection::KeepModel,
                routed: None,
                routed_prevent_default: false,
            },
            2.0,
        )
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn injected_failed_reencode_retains_old_tail_then_refreshes_to_actual_all() {
    let mut machine = machine();
    let pending = machine.output.clone();
    let start = metadata_start(&machine.output);
    let (calls, _) = register_all(&mut machine);
    {
        let _failure = output::inject_encode_failure();
        assert!(matches!(
            machine.call(SessionInput::Focus(false), 2.0, None),
            Err(BoundaryError::Invalid("injected output encode failure"))
        ));
    }
    assert_eq!(machine.output, pending);
    assert!(machine.listener_metadata.is_some());
    assert_eq!(metadata_start(&machine.output), start);
    let packet = machine.take_output().unwrap();
    assert_eq!(&packet[..start], &pending[..start]);
    assert_all(&metadata(&packet));
    assert!(machine.take_output().unwrap().is_empty());
    machine
        .editor(
            Input::KeyDown {
                event: KeyEvent {
                    key: "x".into(),
                    ..Default::default()
                },
                selection: ViewSelection::KeepModel,
                routed: None,
                routed_prevent_default: false,
            },
            3.0,
        )
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn injected_observer_exposure_failure_keeps_packet_and_tail_for_one_retry() {
    let mut machine = machine();
    let pending = machine.output.clone();
    let start = metadata_start(&machine.output);
    let (calls, _) = register_all(&mut machine);
    machine.decorator_observer.inject_expose_failure();
    assert!(matches!(
        machine.take_output(),
        Err(BoundaryError::Invalid(
            "injected observation exposure failure"
        ))
    ));
    assert_eq!(machine.output, pending);
    assert!(machine.listener_metadata.is_some());
    assert_eq!(metadata_start(&machine.output), start);
    assert_all(&metadata(&machine.take_output().unwrap()));
    assert!(machine.take_output().unwrap().is_empty());
    machine
        .editor(
            Input::KeyDown {
                event: KeyEvent {
                    key: "x".into(),
                    ..Default::default()
                },
                selection: ViewSelection::KeepModel,
                routed: None,
                routed_prevent_default: false,
            },
            3.0,
        )
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn metadata_only_and_real_io_packets_retain_their_distinct_renderer_contract() {
    let mut machine = machine();
    machine.take_output().unwrap();
    let flags = machine.call(SessionInput::Focus(false), 2.0, None).unwrap();
    assert_ne!(flags & 1, 0);
    let packet = machine.take_output().unwrap();
    assert!(!metadata(&packet).flag);
    assert_eq!(u32::from_le_bytes(packet[12..16].try_into().unwrap()), 0);
    assert_eq!(u32::from_le_bytes(packet[20..24].try_into().unwrap()), 1);
    let original = document_session::SessionOutput {
        io: vec![IoEffect::SocketPing { conn: ConnId(42) }],
        ..Default::default()
    };
    let mut buffer = vec![];
    let flags = output::encode(&original, false, &mut buffer, None, None).unwrap();
    assert_ne!(flags & 2, 0);
    let before = buffer.clone();
    let Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    output::append_listener_table(session.surface().listener_table(), &mut buffer).unwrap();
    assert!(metadata(&buffer).flag);
    assert_eq!(&buffer[..20], &before[..20]);
    assert_eq!(&buffer[24..before.len()], &before[24..]);
}

#[test]
fn transfer_after_last_all_removal_restores_only_and_keeps_real_packet_prefix() {
    let mut machine = machine();
    machine.take_output().unwrap();
    let (calls, id) = register_all(&mut machine);
    machine.call(SessionInput::Focus(false), 2.0, None).unwrap();
    assert_all(&metadata(&machine.output));
    let pending = machine.output.clone();
    let start = metadata_start(&pending);
    let Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    session.unregister_command_listener(&id);
    let transferred = machine.take_output().unwrap();
    assert_eq!(&pending[..start], &transferred[..start]);
    let effect = metadata(&transferred);
    let index = effect
        .keys
        .iter()
        .position(|command| command == "KeyDown")
        .unwrap();
    let priorities: Vec<u32> = serde_json::from_str(&effect.style).unwrap();
    assert_eq!(priorities[index], 2);
    assert!(effect
        .keys
        .iter()
        .any(|command| command == "KeyDownOnly:[\"ArrowUp\",\"ArrowDown\"]"));
    machine
        .editor(
            Input::KeyDown {
                event: KeyEvent {
                    key: "x".into(),
                    ..Default::default()
                },
                selection: ViewSelection::KeepModel,
                routed: None,
                routed_prevent_default: false,
            },
            3.0,
        )
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn raw_registry_owner_and_registration_never_select_metadata_transport() {
    let mut machine = create_machine(false);
    machine.take_output().unwrap();
    let registry = machine.view_commands().unwrap();
    let owner = registry.owner();
    assert_ne!(owner, 0);
    let Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    registry.register(session, 1, 4).unwrap();
    assert!(matches!(
        machine.listener_metadata_protocol,
        ListenerMetadataProtocol::Disabled
    ));
    assert_eq!(
        machine.call(SessionInput::Focus(false), 2.0, None).unwrap(),
        0
    );
    assert!(machine.take_output().unwrap().is_empty());
}

#[test]
fn metadata_opt_in_owner_drain_and_terminal_retire_are_explicit() {
    let mut machine = create_machine(false);
    let owner = machine.view_commands().unwrap().owner();
    assert!(machine.enable_listener_metadata(owner + 1).is_err());
    assert!(machine.enable_listener_metadata(owner).is_err()); // pending legacy seed
    machine.take_output().unwrap();
    machine.enable_listener_metadata(owner).unwrap();
    machine.enable_listener_metadata(owner).unwrap();
    assert!(matches!(
        machine.listener_metadata_protocol,
        ListenerMetadataProtocol::Enabled
    ));
    machine.retire_view_observation();
    assert!(machine.enable_listener_metadata(owner).is_err());
    machine.initialize_view().unwrap();
    assert!(matches!(
        machine.listener_metadata_protocol,
        ListenerMetadataProtocol::Closed
    ));
    assert_eq!(
        machine.call(SessionInput::Focus(false), 3.0, None).unwrap(),
        0
    );
    let mut raw = create_machine(false);
    raw.take_output().unwrap();
    let owner = raw.view_commands().unwrap().owner();
    raw.retire_view_observation();
    assert!(raw.enable_listener_metadata(owner).is_err());
    raw.initialize_view().unwrap();
    assert!(matches!(
        raw.listener_metadata_protocol,
        ListenerMetadataProtocol::Closed
    ));
}

#[derive(Default)]
struct Counting(std::sync::atomic::AtomicUsize);
impl document_session::ReportedModelErrorObserver for Counting {
    fn reported(&self, _: &lexical_model::Error, _: usize) {
        self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Either bind order keeps every observer: the session's single slot holds the machine fan-out.
#[test]
fn reported_errors_reach_every_observer_in_either_bind_order() {
    for registry_first in [true, false] {
        let mut machine = machine();
        let registry = Arc::new(Counting::default());
        let code_tokens = Arc::new(Counting::default());
        let order: [Arc<Counting>; 2] = if registry_first {
            [registry.clone(), code_tokens.clone()]
        } else {
            [code_tokens.clone(), registry.clone()]
        };
        for observer in order {
            machine.observe_reported_errors(observer).unwrap();
        }
        let fan_out = machine.reported_errors.clone().expect("installed once");
        document_session::ReportedModelErrorObserver::reported(
            &*fan_out,
            &lexical_model::Error::Invariant("probe"),
            0,
        );
        assert_eq!(
            (
                registry.0.load(std::sync::atomic::Ordering::Relaxed),
                code_tokens.0.load(std::sync::atomic::Ordering::Relaxed)
            ),
            (1, 1),
            "registry_first={registry_first}"
        );
    }
}
