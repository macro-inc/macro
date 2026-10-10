use super::*;
use serde_json::json;

const FAVORITES: RelationDeclaration = RELATIONS[0];

fn schema() -> std::sync::Arc<Schema> {
    crate::meta::bundled_schema()
}

fn favorite(id: &str, entity_type: &str, sort_order: f64) -> Record {
    Record {
        fields: BTreeMap::from([
            (
                "__typename".into(),
                CacheValue::String("GraphqlFavorite".into()),
            ),
            ("id".into(), CacheValue::String(id.into())),
            ("entityType".into(), CacheValue::String(entity_type.into())),
            ("entityId".into(), CacheValue::String(id.into())),
            (
                "sortOrder".into(),
                CacheValue::Number(CacheNumber::Float(sort_order)),
            ),
            ("createdAt".into(), CacheValue::String("2026-10-01".into())),
        ]),
    }
}

fn key(id: &str) -> EntityKey<'static> {
    EntityKey::entity("GraphqlFavorite", &[id])
}

fn arguments(value: Json) -> serde_json::Map<String, Json> {
    value.as_object().unwrap().clone()
}

#[test]
fn the_bundled_schema_declares_favorites_as_a_relation() {
    let schema = schema();
    let policies = schema.membership();
    assert!(
        policies.diagnostics().is_empty(),
        "{:?}",
        policies.diagnostics()
    );
    let id = policies.relation("GraphqlUser", "favorites").unwrap();
    assert_eq!(policies.get(id).child_type, "GraphqlFavorite");
    assert!(policies.is_child_type("GraphqlFavorite"));
    assert_eq!(policies.relation("GraphqlUser", "soup"), None);
}

#[test]
fn invalid_declarations_stay_opaque_with_a_diagnostic() {
    let schema = schema();
    let broken = [
        RelationDeclaration {
            field: "missing",
            ..FAVORITES
        },
        RelationDeclaration {
            child_type: "GraphqlProject",
            ..FAVORITES
        },
        RelationDeclaration {
            order: &["nope"],
            ..FAVORITES
        },
        RelationDeclaration {
            arguments: &[ArgumentFilter {
                argument: &["filter", "entityTypes"],
                child_field: "missing",
            }],
            ..FAVORITES
        },
        RelationDeclaration {
            field: "id",
            ..FAVORITES
        },
        RelationDeclaration {
            parent_type: "Unknown",
            ..FAVORITES
        },
    ];
    let policies = MembershipPolicies::compile(&schema, &broken);
    assert_eq!(policies.diagnostics().len(), broken.len());
    assert!(policies.diagnostics()[0].contains("GraphqlUser.missing stays opaque"));
    assert_eq!(policies.relation("GraphqlUser", "favorites"), None);
    assert!(!policies.is_child_type("GraphqlFavorite"));
}

#[test]
fn filters_follow_declared_arguments_and_reject_others() {
    let schema = schema();
    let relation = schema.membership().get(0);
    let owner = EntityKey::entity("GraphqlUser", &["viewer"]);
    let all = relation
        .filter(&owner, &arguments(json!({"filter": null})))
        .unwrap();
    assert_eq!(all.matches(&favorite("a", "DOCUMENT", 1.0)), Some(true));
    let empty = relation
        .filter(
            &owner,
            &arguments(json!({"filter": {"entityTypes": [], "entityIds": []}})),
        )
        .unwrap();
    assert_eq!(empty.matches(&favorite("a", "CHAT", 1.0)), Some(true));
    let documents = relation
        .filter(
            &owner,
            &arguments(json!({"filter": {"entityTypes": ["DOCUMENT"], "entityIds": ["a", "b"]}})),
        )
        .unwrap();
    assert_eq!(
        documents.matches(&favorite("a", "DOCUMENT", 1.0)),
        Some(true)
    );
    assert_eq!(documents.matches(&favorite("a", "CHAT", 1.0)), Some(false));
    assert_eq!(
        documents.matches(&favorite("c", "DOCUMENT", 1.0)),
        Some(false)
    );
    let mut partial = favorite("a", "DOCUMENT", 1.0);
    partial.fields.remove("entityType");
    assert_eq!(documents.matches(&partial), None);
    // Undeclared arguments cannot be evaluated locally.
    for unsupported in [
        json!({"filter": null, "limit": 5}),
        json!({"filter": {"query": "x"}}),
        json!({"filter": {"entityIds": "a"}}),
        json!({"filter": {"entityIds": [{"nested": true}]}}),
    ] {
        assert!(
            relation
                .filter(&owner, &arguments(unsupported.clone()))
                .is_none(),
            "{unsupported}"
        );
    }
    // Undeclared arguments that are null constrain nothing.
    assert!(
        relation
            .filter(&owner, &arguments(json!({"filter": null, "limit": null})))
            .is_some()
    );
}

struct Children(BTreeMap<EntityKey<'static>, Option<Record>>);

impl Children {
    fn new(records: &[(&str, Option<Record>)]) -> Self {
        Self(
            records
                .iter()
                .map(|(id, record)| (key(id), record.clone()))
                .collect(),
        )
    }

    fn child(&self, key: &EntityKey<'static>) -> Child<'_> {
        Child {
            resolved: key.clone(),
            record: self.0.get(key).and_then(Option::as_ref),
        }
    }
}

fn refs(ids: &[&str]) -> Vec<CacheValue> {
    ids.iter().map(|id| CacheValue::Ref(key(id))).collect()
}

#[test]
fn derivation_inserts_in_order_removes_and_keeps_untouched_evidence() {
    let schema = schema();
    let relation = schema.membership().get(0);
    let owner = EntityKey::entity("GraphqlUser", &["viewer"]);
    let filter = relation
        .filter(
            &owner,
            &arguments(json!({"filter": {"entityTypes": ["DOCUMENT"]}})),
        )
        .unwrap();
    let children = Children::new(&[
        ("a", Some(favorite("a", "DOCUMENT", 1.0))),
        ("b", Some(favorite("b", "DOCUMENT", 2.0))),
        ("c", Some(favorite("c", "DOCUMENT", 3.0))),
        // Untouched evidence keeps its place even though it does not match.
        ("stale", Some(favorite("stale", "CHAT", 4.0))),
        ("new", Some(favorite("new", "DOCUMENT", 2.5))),
        ("other", Some(favorite("other", "CHAT", 0.0))),
        ("gone", None),
    ]);
    let evidence = refs(&["a", "b", "c", "stale", "gone"]);
    let changed: BTreeSet<_> = ["new", "other", "gone", "a"].into_iter().map(key).collect();
    let derived = derive(relation, &filter, &evidence, &changed, &|key| {
        children.child(key)
    });
    assert_eq!(
        derived,
        Derivation {
            value: CacheValue::List(refs(&["a", "b", "new", "c", "stale"])),
            unknown: false,
        }
    );
    // Ties on sort order fall back to creation time, then the key.
    let tie = Children::new(&[
        ("a", Some(favorite("a", "DOCUMENT", 1.0))),
        ("z", Some(favorite("z", "DOCUMENT", 1.0))),
        ("m", Some(favorite("m", "DOCUMENT", 1.0))),
    ]);
    let derived = derive(
        relation,
        &filter,
        &refs(&["a", "z"]),
        &[key("m")].into(),
        &|key| tie.child(key),
    );
    assert_eq!(derived.value, CacheValue::List(refs(&["a", "m", "z"])));
}

#[test]
fn derivation_keeps_evidence_when_membership_or_order_is_unknown() {
    let schema = schema();
    let relation = schema.membership().get(0);
    let owner = EntityKey::entity("GraphqlUser", &["viewer"]);
    let filter = relation
        .filter(
            &owner,
            &arguments(json!({"filter": {"entityTypes": ["DOCUMENT"]}})),
        )
        .unwrap();
    let mut untyped = favorite("new", "DOCUMENT", 1.0);
    untyped.fields.remove("entityType");
    let mut unordered = favorite("a", "DOCUMENT", 1.0);
    unordered.fields.remove("sortOrder");
    for children in [
        Children::new(&[
            ("a", Some(favorite("a", "DOCUMENT", 1.0))),
            ("new", Some(untyped)),
        ]),
        Children::new(&[
            ("a", Some(unordered)),
            ("new", Some(favorite("new", "DOCUMENT", 2.0))),
        ]),
    ] {
        let derived = derive(
            relation,
            &filter,
            &refs(&["a"]),
            &[key("new")].into(),
            &|key| children.child(key),
        );
        assert_eq!(
            derived,
            Derivation {
                value: CacheValue::List(refs(&["a"])),
                unknown: true,
            }
        );
    }
}
