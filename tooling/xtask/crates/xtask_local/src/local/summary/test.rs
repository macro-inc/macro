use super::*;

#[test]
fn printed_commands_carry_an_explicit_port_base_only_when_it_differs() {
    let derived = Instance::derive(Some("agent-a"), None).unwrap();
    assert_eq!(instance_flags(&derived), " --instance agent-a");

    let same = Instance::derive(Some("agent-a"), Some(derived.port_base())).unwrap();
    assert_eq!(instance_flags(&same), " --instance agent-a");

    let other_base = if derived.port_base() == 21000 {
        22000
    } else {
        21000
    };
    let explicit = Instance::derive(Some("agent-a"), Some(other_base)).unwrap();
    assert_eq!(
        rebuild_command(&explicit),
        format!("just run_local rebuild --instance agent-a --port-base {other_base}")
    );

    let default = Instance::derive(None, None).unwrap();
    assert_eq!(stop_command(&default), "just stop_local");
}
