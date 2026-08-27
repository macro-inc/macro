use chrono::{TimeZone, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_soup::{document::SoupDocument, project::SoupProject};
use uuid::Uuid;

use super::*;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned()
}

fn timestamp(micros: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
        + chrono::Duration::microseconds(i64::from(micros))
}

#[test]
fn document_projection_contains_only_direct_profile_facts() {
    let id = Uuid::from_u128(1);
    let project_id = Uuid::from_u128(2);
    let document = SoupDocument {
        id,
        document_version_id: 3,
        owner_id: owner(),
        name: "Document".to_owned(),
        file_type: Some("md".to_owned()),
        sha: None,
        project_id: Some(project_id),
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: timestamp(123_456),
        updated_at: timestamp(654_321),
        viewed_at: None,
        sub_type: None,
        deleted_at: None,
        extra: (),
    };

    let projection =
        project_document(RecordKey::new("GraphqlSoupDocument:1").unwrap(), &document).unwrap();

    assert_eq!(projection.profile, vocabulary::profile());
    assert_eq!(projection.partition, vocabulary::document_partition());
    assert_eq!(projection.exact_facts.len(), 4);
    assert_eq!(projection.integer_facts.len(), 2);
    assert_eq!(projection.sort_facts.len(), 2);
    assert_eq!(
        projection
            .integer_facts
            .iter()
            .find(|fact| fact.attribute == vocabulary::created_at())
            .unwrap()
            .value
            % 1_000_000,
        123_456
    );
}

#[test]
fn optimistic_direct_projection_and_patch_share_authoritative_vocabulary() {
    let key = RecordKey::new("GraphqlSoupDocument:00000000-0000-0000-0000-000000000001").unwrap();
    let projection = project_direct_fields(DirectProjectionInput {
        record_key: key.clone(),
        kind: SoupFlatEntityKind::Document,
        id: Uuid::from_u128(1),
        owner: "macro|owner@example.com".to_owned(),
        project_id: None,
        file_type: Some(".MD".to_owned()),
        created_at: timestamp(1),
        updated_at: timestamp(2),
    })
    .unwrap();
    assert!(projection.exact_facts.iter().any(|fact| {
        fact.attribute == vocabulary::file_type() && fact.value == ExactValue::utf8("md").unwrap()
    }));

    let patch = patch_direct_fields(DirectProjectionPatchInput {
        record_key: key,
        kind: SoupFlatEntityKind::Document,
        owner: None,
        project_id: Some(Some(Uuid::from_u128(2))),
        file_type: Some(None),
        created_at: None,
        updated_at: timestamp(3),
    })
    .unwrap();
    let OptimisticProjectionMutation::Patch {
        exact,
        integers,
        sorts,
        ..
    } = patch
    else {
        panic!("direct field patch must produce generic optimistic patch");
    };
    assert!(
        exact.iter().any(|patch| {
            patch.attribute == vocabulary::project_id() && patch.values.len() == 1
        })
    );
    assert!(
        exact
            .iter()
            .any(|patch| { patch.attribute == vocabulary::file_type() && patch.values.is_empty() })
    );
    assert!(integers.iter().any(|patch| {
        patch.attribute == vocabulary::updated_at()
            && patch.values == vec![utc_timestamp_micros(timestamp(3))]
    }));
    assert!(sorts.iter().any(|fact| {
        fact.attribute == vocabulary::updated_at()
            && fact.value == utc_timestamp_micros(timestamp(3))
    }));
}

#[test]
fn nullable_parent_facts_are_absent_and_not_semantics_remain_exact() {
    let project = SoupProject {
        id: Uuid::from_u128(1),
        name: "Root".to_owned(),
        owner_id: owner(),
        parent_id: None,
        created_at: timestamp(0),
        updated_at: timestamp(0),
        viewed_at: None,
        deleted_at: None,
        extra: (),
    };
    let projection =
        project_project(RecordKey::new("GraphqlSoupProject:1").unwrap(), &project).unwrap();

    assert!(
        projection
            .exact_facts
            .iter()
            .all(|fact| fact.attribute != vocabulary::project_id())
    );
    assert!(
        projection.matches(&predicate_index::PredicateExpr::Not(Box::new(
            predicate_index::PredicateExpr::Exact {
                attribute: vocabulary::project_id(),
                value: ExactValue::new(Uuid::from_u128(2).as_bytes()).unwrap(),
            }
        )))
    );
}
