use super::*;
use agent_runtime_protocol::domain::action::AgentActionId;

/// `turn_prompter_kind` reads back what was written; an unknown value
/// reads as a system turn's, never a person's or a program's.
#[test]
fn stored_prompter_kinds_read_back() {
    assert_eq!(PrompterKind::from_stored("user"), PrompterKind::User);
    assert_eq!(PrompterKind::from_stored("system"), PrompterKind::System);
    assert_eq!(PrompterKind::from_stored("program"), PrompterKind::Program);
    assert_eq!(PrompterKind::from_stored("bogus"), PrompterKind::System);
    assert_eq!(PrompterKind::Program.as_ref(), "program");
}

/// The fallback acts for nobody: a turn whose kind this build can't read
/// spends none of the owner's access, even with the owner on the row.
#[test]
fn an_unknown_kinds_turn_acts_for_nobody() {
    let prompter = TurnPrompter {
        kind: PrompterKind::from_stored("bogus"),
        action_id: AgentActionId::mint(),
        user: Some(MacroUserIdStr::try_from_email("owner@example.com").unwrap()),
        client: None,
    };
    assert_eq!(prompter.acting_user(), None);
}

/// A prompt rewritten by a less trusted kind takes that kind; a person's
/// edit never lifts one a program or nobody wrote.
#[test]
fn an_edit_keeps_the_less_trusted_kind() {
    use PrompterKind::{Program, System, User};
    for (kind, edit, kept) in [
        (User, User, User),
        (User, Program, Program),
        (User, System, System),
        (Program, User, Program),
        (Program, System, System),
        (System, User, System),
        (System, Program, System),
    ] {
        assert_eq!(kind.after_edit(edit), kept, "{kind:?} edited by {edit:?}");
    }
}

/// Serialized kinds decode through the same reader as the column.
#[test]
fn serialized_prompter_kinds_read_back() {
    for (wire, kind) in [
        ("user", PrompterKind::User),
        ("system", PrompterKind::System),
        ("program", PrompterKind::Program),
        ("bogus", PrompterKind::System),
    ] {
        assert_eq!(
            serde_json::from_value::<PrompterKind>(serde_json::json!(wire)).unwrap(),
            kind,
            "{wire}"
        );
    }
    assert_eq!(
        serde_json::to_value(PrompterKind::Program).unwrap(),
        serde_json::json!("program")
    );
}
