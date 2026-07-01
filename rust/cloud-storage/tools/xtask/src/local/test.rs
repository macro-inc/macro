use super::*;

/// Every mode whose spec we assert invariants over.
const MODES: &[Mode] = &[Mode::Local, Mode::Dev];

/// Cross-field design rules every [`ModeSpec`] must satisfy. These encode what
/// makes a mode *coherent* — a new mode that trips one of these is a bug, not a
/// new policy — so they're the real guard on the table, not a restatement of it.
#[test]
fn mode_specs_are_coherent() {
    for &mode in MODES {
        let s = mode.spec();
        // You either own the local plumbing (LocalEnv: dummy creds + localstack
        // endpoint) or you point at deployed AWS and strip those — never both.
        assert!(
            !(s.overlay_local_env && s.uses_remote_aws),
            "{}: overlay_local_env and uses_remote_aws are mutually exclusive",
            s.label
        );
        // Migrations only make sense against a database this mode runs itself.
        assert!(
            !s.migrates_db || s.runs_local_infra,
            "{}: migrates_db requires runs_local_infra",
            s.label
        );
    }
}
