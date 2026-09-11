use super::*;
use predicate_index::{ExactFact, ExactValue};

fn token(value: &str) -> Token {
    Token::new(value).unwrap()
}
fn fact(value: &str) -> ExactFact {
    ExactFact {
        attribute: token("members"),
        value: ExactValue::utf8(value).unwrap(),
    }
}
fn document() -> IndexDocument {
    IndexDocument {
        record_key: RecordKey::new("Entity:1").unwrap(),
        profile: Profile::new(token("p1")),
        partition: token("entity"),
        exact_facts: vec![fact("a"), fact("b")],
        integer_facts: vec![],
        sort_facts: vec![],
    }
}
fn edit(document: &IndexDocument) -> OptimisticProjectionMutation {
    OptimisticProjectionMutation::PatchExact {
        record_key: document.record_key.clone(),
        profile: document.profile.clone(),
        partition: document.partition.clone(),
        remove: vec![fact("a")],
        insert: vec![fact("c")],
    }
}

#[test]
fn member_edits_are_idempotent_and_preserve_unknown_coverage() {
    let doc = document();
    let base = ProjectionState::Complete(doc.clone());
    let mutations = [
        OptimisticProjectionMutation::Unknown {
            record_key: doc.record_key.clone(),
            profile: doc.profile.clone(),
            partition: doc.partition.clone(),
            affected_attributes: vec![token("members")],
        },
        edit(&doc),
        edit(&doc),
    ];
    let projection = compose_effective_optimistic_projection(
        &doc.record_key,
        Some(&base),
        &[ProjectionMutationLayer {
            owner: 1,
            mutations: &mutations,
        }],
    )
    .unwrap()
    .unwrap();
    assert!(projection.uncertainty.affects(&token("members")));
    let OptimisticProjectionState::Complete(document) = projection.state else {
        panic!("complete base retained")
    };
    assert_eq!(document.exact_facts, vec![fact("b"), fact("c")]);
    let missing = apply_authoritative_exact_members(
        None,
        &doc.record_key,
        &doc.profile,
        &doc.partition,
        &[],
        &[fact("a")],
    );
    assert!(matches!(missing, ProjectionState::Incomplete { .. }));
}

#[test]
fn member_growth_beyond_budget_is_incomplete_not_an_enqueue_failure() {
    let mut doc = document();
    doc.exact_facts = (0..predicate_index::MAX_FACTS_PER_DOCUMENT)
        .map(|i| fact(&i.to_string()))
        .collect();
    let mutation = OptimisticProjectionMutation::PatchExact {
        record_key: doc.record_key.clone(),
        profile: doc.profile.clone(),
        partition: doc.partition.clone(),
        remove: vec![],
        insert: vec![fact("new")],
    };
    let projection = compose_effective_optimistic_projection(
        &doc.record_key,
        Some(&ProjectionState::Complete(doc.clone())),
        &[ProjectionMutationLayer {
            owner: 1,
            mutations: &[mutation],
        }],
    )
    .unwrap()
    .unwrap();
    assert!(matches!(
        projection.state,
        OptimisticProjectionState::Incomplete {
            kind: ProjectionIncompleteKind::Dirty,
            ..
        }
    ));
}
