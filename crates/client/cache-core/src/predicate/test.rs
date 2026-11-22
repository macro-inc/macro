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
fn large_member_edits_preserve_sets_and_are_idempotent() {
    let mut doc = document();
    doc.exact_facts
        .extend((0..10_000).map(|i| fact(&i.to_string())));
    let removed = doc.exact_facts.clone();
    let mutation = OptimisticProjectionMutation::PatchExact {
        record_key: doc.record_key.clone(),
        profile: doc.profile.clone(),
        partition: doc.partition.clone(),
        remove: removed.clone(),
        // Overlapping removal/insertion keeps the inserted member.
        insert: vec![fact("a"), fact("new"), fact("new")],
    };
    let projection = compose_effective_optimistic_projection(
        &doc.record_key,
        Some(&ProjectionState::Complete(doc.clone())),
        &[ProjectionMutationLayer {
            owner: 1,
            mutations: &[mutation.clone(), mutation],
        }],
    )
    .unwrap()
    .unwrap();
    let OptimisticProjectionState::Complete(effective) = projection.state else {
        panic!("large member sets remain complete");
    };
    assert_eq!(effective.exact_facts, vec![fact("a"), fact("new")]);

    let state = apply_authoritative_exact_members(
        Some(&ProjectionState::Complete(doc.clone())),
        &doc.record_key,
        &doc.profile,
        &doc.partition,
        &removed,
        &[fact("a"), fact("new")],
    );
    assert_eq!(state, ProjectionState::Complete(effective));
}

#[test]
fn attribute_growth_beyond_budget_is_incomplete_not_an_enqueue_failure() {
    let mut doc = document();
    doc.exact_facts = (0..predicate_index::MAX_ATTRIBUTES_PER_DOCUMENT)
        .map(|i| ExactFact {
            attribute: token(&format!("attribute-{i}")),
            value: ExactValue::utf8("value").unwrap(),
        })
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

mod derived_sort_facts {
    use super::*;
    use item_filter_index::mail::INBOX_VIEW_DERIVATION as VIEW;

    fn flag(attribute: &str, on: bool) -> ExactFact {
        ExactFact {
            attribute: token(attribute),
            value: ExactValue::new([u8::from(on)]).unwrap(),
        }
    }
    fn sort(attribute: &str, value: i64) -> IntegerFact {
        IntegerFact {
            attribute: token(attribute),
            value,
        }
    }
    /// A stored Mail thread; `view` is the derived copy it carries.
    fn thread(inbox: bool, inbox_ts: i64, view: Option<i64>) -> IndexDocument {
        let mut document = IndexDocument {
            record_key: RecordKey::new("GraphqlSoupEmailThread:1").unwrap(),
            profile: Profile::new(token(VIEW.profiles[1])),
            partition: token("email"),
            exact_facts: vec![flag("mail-inbox", inbox), flag("mail-has-message", true)],
            integer_facts: vec![],
            sort_facts: std::iter::once(sort(VIEW.source, inbox_ts))
                .chain(view.map(|value| sort(VIEW.target, value)))
                .collect(),
        };
        document.canonicalize();
        document
    }
    fn patch(
        document: &IndexDocument,
        exact: Vec<ExactFact>,
        sorts: Vec<IntegerFact>,
    ) -> OptimisticProjectionMutation {
        OptimisticProjectionMutation::Patch {
            record_key: document.record_key.clone(),
            profile: document.profile.clone(),
            partition: document.partition.clone(),
            exact: exact
                .into_iter()
                .map(|fact| ExactAttributePatch {
                    attribute: fact.attribute,
                    values: vec![fact.value],
                })
                .collect(),
            integers: vec![],
            sorts,
        }
    }
    fn unknown(document: &IndexDocument, attributes: &[&str]) -> OptimisticProjectionMutation {
        OptimisticProjectionMutation::Unknown {
            record_key: document.record_key.clone(),
            profile: document.profile.clone(),
            partition: document.partition.clone(),
            affected_attributes: attributes
                .iter()
                .map(|attribute| token(attribute))
                .collect(),
        }
    }
    fn compose(
        base: &IndexDocument,
        mutations: &[OptimisticProjectionMutation],
    ) -> EffectiveOptimisticProjection {
        compose_effective_optimistic_projection(
            &base.record_key,
            Some(&ProjectionState::Complete(base.clone())),
            &[ProjectionMutationLayer {
                owner: 1,
                mutations,
            }],
        )
        .unwrap()
        .unwrap()
    }
    fn view_of(projection: &EffectiveOptimisticProjection) -> Option<i64> {
        let OptimisticProjectionState::Complete(document) = &projection.state else {
            panic!("complete shadow")
        };
        document
            .sort_facts
            .iter()
            .find(|fact| fact.attribute.as_str() == VIEW.target)
            .map(|fact| fact.value)
    }

    /// A queued unarchive stored by a build without the derived fact, rebased
    /// over an archived thread, still shows in the Inbox view.
    #[test]
    fn an_old_patch_rebased_over_an_archived_thread_gets_the_view_fact() {
        let base = thread(false, 30, None);
        let shadow = compose(
            &base,
            &[patch(&base, vec![flag("mail-inbox", true)], vec![])],
        );
        assert_eq!(view_of(&shadow), Some(30));
        assert!(!shadow.uncertainty.affects(&token(VIEW.target)));
    }

    /// A patch's copy of the view fact, taken before the source moved, never
    /// outlives the source: the shadow follows the authority's newer value.
    #[test]
    fn a_captured_view_value_follows_the_newer_source() {
        let base = thread(true, 30, Some(30));
        let stale = patch(
            &base,
            vec![flag("mail-inbox", true)],
            vec![sort(VIEW.target, 10)],
        );
        assert_eq!(
            view_of(&compose(&base, std::slice::from_ref(&stale))),
            Some(30)
        );
        // The same holds for the authoritative patch path.
        let OptimisticProjectionMutation::Patch {
            record_key,
            profile,
            partition,
            exact,
            integers,
            sorts,
        } = &stale
        else {
            unreachable!()
        };
        let ProjectionState::Complete(authoritative) = apply_authoritative_projection_patch(
            Some(&ProjectionState::Complete(base.clone())),
            record_key,
            profile,
            partition,
            exact,
            integers,
            sorts,
        ) else {
            panic!("complete authority")
        };
        assert!(authoritative.sort_facts.contains(&sort(VIEW.target, 30)));
        // Leaving the Inbox removes the copy instead of leaving it stale.
        let archived = compose(
            &base,
            &[patch(&base, vec![flag("mail-inbox", false)], vec![])],
        );
        assert_eq!(view_of(&archived), None);
    }

    /// The copy is uncertain while its source is, even after a patch that
    /// names the copy itself, and certain once every input is.
    #[test]
    fn the_view_fact_is_as_uncertain_as_its_inputs() {
        let base = thread(true, 30, Some(30));
        let shadow = compose(
            &base,
            &[
                unknown(&base, &[VIEW.source]),
                patch(&base, vec![], vec![sort(VIEW.target, 10)]),
            ],
        );
        assert!(shadow.uncertainty.affects(&token(VIEW.target)));

        // Everything uncertain, then the source and required facts patched:
        // the copy is certain and the rest stays uncertain.
        let shadow = compose(
            &base,
            &[
                unknown(&base, &[]),
                patch(
                    &base,
                    vec![flag("mail-inbox", true), flag("mail-has-message", true)],
                    vec![sort(VIEW.source, 40)],
                ),
            ],
        );
        assert_eq!(view_of(&shadow), Some(40));
        assert!(!shadow.uncertainty.affects(&token(VIEW.target)));
        assert!(shadow.uncertainty.affects(&token("mail-read")));
    }

    /// Every way a document is composed derives the copy again: an optimistic
    /// or authoritative replacement holding a stale copy, a member edit that
    /// moves the thread out of the Inbox, and a shadow started from an
    /// authority whose copy is stale.
    #[test]
    fn every_composition_step_derives_the_view_fact() {
        let stale = thread(true, 30, Some(10));
        let base = thread(true, 30, Some(30));
        let replaced = compose(
            &base,
            &[OptimisticProjectionMutation::Replace(stale.clone())],
        );
        assert_eq!(view_of(&replaced), Some(30));

        let mut states = HashMap::new();
        apply_authoritative_projection_mutations(
            &mut states,
            &[ProjectionMutation::Replace(stale.clone())],
        );
        let Some(ProjectionState::Complete(authoritative)) = states.get(&stale.record_key) else {
            panic!("complete authority")
        };
        assert!(authoritative.sort_facts.contains(&sort(VIEW.target, 30)));

        let archived = compose(
            &base,
            &[OptimisticProjectionMutation::PatchExact {
                record_key: base.record_key.clone(),
                profile: base.profile.clone(),
                partition: base.partition.clone(),
                remove: vec![flag("mail-inbox", true)],
                insert: vec![flag("mail-inbox", false)],
            }],
        );
        assert_eq!(view_of(&archived), None);

        let from_stale_authority = compose(&stale, &[unknown(&stale, &["mail-read"])]);
        assert_eq!(view_of(&from_stale_authority), Some(30));
    }

    /// A document with the most distinct attributes a document may have
    /// cannot take the derived fact; composing it gives a non-queryable
    /// state instead of an error, so a later mutation (a deletion) still
    /// applies.
    #[test]
    fn a_document_at_the_attribute_limit_composes_incomplete() {
        let mut full = thread(false, 30, None);
        for index in 0..predicate_index::MAX_ATTRIBUTES_PER_DOCUMENT - 3 {
            full.exact_facts.push(flag(&format!("prop-{index}"), true));
        }
        full.canonicalize();
        full.validate().unwrap();
        let unarchive = patch(&full, vec![flag("mail-inbox", true)], vec![]);
        let archive = patch(&full, vec![flag("mail-inbox", false)], vec![]);
        let shadow = compose(&full, std::slice::from_ref(&unarchive));
        assert!(matches!(
            shadow.state,
            OptimisticProjectionState::Incomplete {
                kind: ProjectionIncompleteKind::Dirty,
                ..
            }
        ));
        // Only the composed document counts: an archive after the unarchive
        // brings it back under the limit.
        let rearchived = compose(&full, &[unarchive.clone(), archive]);
        assert_eq!(
            rearchived.state,
            OptimisticProjectionState::Complete(full.clone())
        );
        // An authority past the limit is Missing, as a projection past the
        // limit is: without a shadow, Dirty would revoke the thread's retained
        // server rows.
        let OptimisticProjectionMutation::Patch { exact, .. } = &unarchive else {
            unreachable!()
        };
        assert_eq!(
            apply_authoritative_projection_patch(
                Some(&ProjectionState::Complete(full.clone())),
                &full.record_key,
                &full.profile,
                &full.partition,
                exact,
                &[],
                &[],
            ),
            ProjectionState::Incomplete {
                record_key: full.record_key.clone(),
                profile: full.profile.clone(),
                partition: full.partition.clone(),
                kind: ProjectionIncompleteKind::Missing,
            }
        );
        let deleted = compose(
            &full,
            &[
                unarchive,
                OptimisticProjectionMutation::Delete {
                    record_key: full.record_key.clone(),
                    profile: full.profile.clone(),
                    partition: full.partition.clone(),
                },
            ],
        );
        assert!(matches!(
            deleted.state,
            OptimisticProjectionState::Deleted { .. }
        ));

        let mut eligible = full.clone();
        eligible
            .exact_facts
            .retain(|fact| fact.attribute.as_str() != "mail-inbox");
        eligible.exact_facts.push(flag("mail-inbox", true));
        eligible.canonicalize();
        let replaced = compose(
            &full,
            &[OptimisticProjectionMutation::Replace(eligible.clone())],
        );
        assert!(matches!(
            replaced.state,
            OptimisticProjectionState::Incomplete { .. }
        ));
        let mut states = HashMap::new();
        apply_authoritative_projection_mutations(
            &mut states,
            &[ProjectionMutation::Replace(eligible.clone())],
        );
        assert!(matches!(
            states.get(&eligible.record_key),
            Some(ProjectionState::Incomplete {
                kind: ProjectionIncompleteKind::Missing,
                ..
            })
        ));
        // An authority stored before the rule starts the shadow incomplete.
        let started = compose(&eligible, &[unknown(&eligible, &["mail-read"])]);
        assert!(matches!(
            started.state,
            OptimisticProjectionState::Incomplete { .. }
        ));
    }
}
