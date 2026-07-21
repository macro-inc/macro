use super::*;

#[test]
fn default_instance_reproduces_the_fixed_ports() {
    let instance = Instance::derive(None, None).unwrap();
    let rendered = render(&instance);

    assert!(
        rendered
            .contains(r#"export DATABASE_URL="${DATABASE_URL:-postgres://user:password@localhost:5432/macrodb}""#),
        "{rendered}"
    );
    assert!(
        rendered.contains(r#"export LOCAL_AWS_URL="${LOCAL_AWS_URL:-http://localhost:4566}""#),
        "{rendered}"
    );
    assert!(
        rendered.contains(
            r#"export FUSIONAUTH_BASE_URL="${FUSIONAUTH_BASE_URL:-http://localhost:9011}""#
        ),
        "{rendered}"
    );
    assert!(
        rendered.contains(r#"export FRONTEND_PORT="${FRONTEND_PORT:-3000}""#),
        "{rendered}"
    );
}

#[test]
fn named_instance_shifts_into_its_port_window() {
    let instance = Instance::derive(Some("agent-a"), None).unwrap();
    let base = instance.port_base();

    // Every emitted port sits in the instance's stride, and each keeps its
    // per-port offset (Postgres is the stride base).
    assert!(
        render(&instance).contains(&format!("localhost:{base}/macrodb")),
        "postgres should bind the stride base {base}"
    );
    assert_eq!(instance.port(Port::Postgres), base);
    assert!(instance.port(Port::FusionAuth) > base);
    assert_ne!(instance.port(Port::FusionAuth), 9011);
}

#[test]
fn overrides_are_preserved_via_shell_default_expansion() {
    let instance = Instance::derive(Some("agent-a"), None).unwrap();
    // Each line is `${VAR:-...}`, so a value already exported wins.
    for line in render(&instance).lines() {
        assert!(line.contains(":-"), "line must preserve overrides: {line}");
    }
}
