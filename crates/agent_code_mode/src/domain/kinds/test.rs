use super::*;

#[test]
fn a_turn_keeps_the_first_kind_it_settled() {
    let mut kinds = TurnKinds::default();
    let session = AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let turn = macro_uuid::generate_uuid_v7();
    assert_eq!(
        kinds.settle(session, turn, CodeModeKind::Dialect),
        CodeModeKind::Dialect
    );
    assert_eq!(
        kinds.settle(session, turn, CodeModeKind::TypeScript),
        CodeModeKind::Dialect
    );
    let next = macro_uuid::generate_uuid_v7();
    assert_eq!(kinds.get(session, next), None);
    assert_eq!(
        kinds.settle(session, next, CodeModeKind::TypeScript),
        CodeModeKind::TypeScript
    );
}

#[test]
fn the_oldest_turn_is_forgotten_past_the_bound() {
    let mut kinds = TurnKinds::default();
    let session = AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let first = macro_uuid::generate_uuid_v7();
    kinds.settle(session, first, CodeModeKind::Dialect);
    for _ in 0..MAX_TURNS {
        kinds.settle(
            session,
            macro_uuid::generate_uuid_v7(),
            CodeModeKind::Dialect,
        );
    }
    assert_eq!(kinds.get(session, first), None);
    assert_eq!(kinds.kinds.len(), MAX_TURNS);
}
