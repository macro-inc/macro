use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};
use chrono::{TimeZone, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_soup::{
    chat::SoupChat,
    document::{SoupDocument, SoupDocumentSubType},
    project::SoupProject,
};
use uuid::Uuid;

use super::*;
use soup::domain::models::SoupDocumentServerFacts;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned()
}

fn timestamp(micros: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
        + chrono::Duration::microseconds(i64::from(micros))
}

fn document(id: Uuid, sub_type: Option<SoupDocumentSubType>) -> SoupDocument<()> {
    SoupDocument {
        id,
        document_version_id: 3,
        owner_id: owner(),
        name: "Document".to_owned(),
        file_type: Some("md".to_owned()),
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: timestamp(0),
        updated_at: timestamp(1),
        viewed_at: None,
        sub_type,
        deleted_at: None,
        extra: (),
    }
}

fn document_hydration(
    id: Uuid,
    sub_type: Option<SoupDocumentSubType>,
    is_email_attachment: bool,
) -> SoupProjectionHydration {
    SoupProjectionHydration {
        item: SoupItem::Document(document(id, sub_type)),
        document_server_facts: Some(SoupDocumentServerFacts {
            is_email_attachment,
            is_important: true,
            status_option_ids: Vec::new(),
        }),
    }
}

fn document_key(id: Uuid) -> RecordKey {
    RecordKey::new(format!("GraphqlSoupDocument:{id}")).unwrap()
}

#[test]
fn document_projection_contains_only_direct_profile_facts() {
    let id = Uuid::from_u128(1);
    let project_id = Uuid::from_u128(2);
    let mut document = document(id, None);
    document.project_id = Some(project_id);
    document.created_at = timestamp(123_456);
    document.updated_at = timestamp(654_321);

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
    let key = document_key(Uuid::from_u128(1));
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
        updated_at: Some(timestamp(3)),
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

#[test]
fn document_supplement_contains_only_authoritative_relation_state() {
    let id = Uuid::from_u128(1);
    let hydration = document_hydration(
        id,
        Some(SoupDocumentSubType::Task { is_completed: true }),
        false,
    );
    let supplement = project_soup_cache_supplement(document_key(id), &hydration)
        .unwrap()
        .unwrap();

    assert_eq!(supplement.target_profile(), &vocabulary::profile_v3());
    assert_eq!(supplement.partition(), &vocabulary::document_partition());
    assert_eq!(supplement.record_key(), &document_key(id));
    assert!(!supplement.is_email_attachment());
    assert_eq!(supplement.is_important(), Some(true));
    assert_eq!(supplement.status_option_ids(), Some(&[] as &[Uuid]));

    let wire = SoupCacheProjectionCapsuleV2::try_from(&supplement).unwrap();
    assert_eq!(wire.target_profile, "soup-flat-v3");
    assert_eq!(wire.partition, "document");
    assert!(!wire.is_email_attachment);
    assert!(wire.is_important);
    assert!(wire.status_option_ids.is_empty());
}

#[test]
fn entities_without_document_server_facts_do_not_emit_supplements() {
    let project = SoupProjectionHydration {
        item: SoupItem::Project(SoupProject {
            id: Uuid::from_u128(2),
            name: "Project".to_owned(),
            owner_id: owner(),
            parent_id: None,
            created_at: timestamp(0),
            updated_at: timestamp(1),
            viewed_at: None,
            deleted_at: None,
            extra: (),
        }),
        document_server_facts: None,
    };
    let chat = SoupProjectionHydration {
        item: SoupItem::Chat(SoupChat {
            id: Uuid::from_u128(3),
            name: "Chat".to_owned(),
            owner_id: owner(),
            project_id: None,
            is_persistent: true,
            created_at: timestamp(0),
            updated_at: timestamp(1),
            viewed_at: None,
            deleted_at: None,
            extra: (),
        }),
        document_server_facts: None,
    };

    assert!(
        project_soup_cache_supplement(
            RecordKey::new("GraphqlSoupProject:00000000-0000-0000-0000-000000000002").unwrap(),
            &project,
        )
        .unwrap()
        .is_none()
    );
    assert!(
        project_soup_cache_supplement(
            RecordKey::new("GraphqlSoupChat:00000000-0000-0000-0000-000000000003").unwrap(),
            &chat,
        )
        .unwrap()
        .is_none()
    );
}

#[test]
fn document_server_facts_attached_to_another_entity_are_rejected() {
    let hydration = SoupProjectionHydration {
        item: SoupItem::Project(SoupProject {
            id: Uuid::from_u128(2),
            name: "Project".to_owned(),
            owner_id: owner(),
            parent_id: None,
            created_at: timestamp(0),
            updated_at: timestamp(1),
            viewed_at: None,
            deleted_at: None,
            extra: (),
        }),
        document_server_facts: Some(SoupDocumentServerFacts {
            is_email_attachment: false,
            is_important: true,
            status_option_ids: Vec::new(),
        }),
    };
    assert!(matches!(
        project_soup_cache_supplement(
            RecordKey::new("GraphqlSoupProject:00000000-0000-0000-0000-000000000002").unwrap(),
            &hydration,
        ),
        Err(ProjectionError::SourceMismatch)
    ));
}

#[test]
fn supplement_capsule_v2_native_golden_round_trip_is_deterministic() {
    let id = Uuid::from_u128(1);
    let supplement = project_soup_cache_supplement(
        document_key(id),
        &document_hydration(id, Some(SoupDocumentSubType::Snippet {}), false),
    )
    .unwrap()
    .unwrap();

    let encoded = encode_cache_projection_supplement(&supplement).unwrap();
    assert_eq!(
        encoded,
        "Agxzb3VwLWZsYXQtdjM4R3JhcGhxbFNvdXBEb2N1bWVudDowMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEIZG9jdW1lbnQAAQA"
    );
    assert_eq!(
        decode_cache_projection_supplement(&encoded).unwrap(),
        supplement
    );

    let status_supplement = SoupCacheProjectionSupplement::document(
        document_key(id),
        true,
        false,
        vec![Uuid::from_u128(11), Uuid::from_u128(12)],
    );
    let encoded = encode_cache_projection_supplement(&status_supplement).unwrap();
    assert_eq!(
        encoded,
        "Agxzb3VwLWZsYXQtdjM4R3JhcGhxbFNvdXBEb2N1bWVudDowMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEIZG9jdW1lbnQBAAIQAAAAAAAAAAAAAAAAAAAACxAAAAAAAAAAAAAAAAAAAAAM"
    );
    assert_eq!(
        decode_cache_projection_supplement(&encoded).unwrap(),
        status_supplement
    );
}

#[test]
fn complete_v3_projection_contains_viewer_importance_and_status_facts() {
    let id = Uuid::from_u128(1);
    let status_a = Uuid::from_u128(11);
    let status_b = Uuid::from_u128(12);
    let document = document(id, None);
    let supplement = SoupCacheProjectionSupplement::document(
        document_key(id),
        false,
        false,
        vec![status_b, status_a, status_b],
    );
    assert_eq!(
        supplement.status_option_ids(),
        Some([status_a, status_b].as_slice())
    );

    let projection = compose_soup_flat_v3(
        DirectProjectionInput {
            record_key: document_key(id),
            kind: SoupFlatEntityKind::Document,
            id: document.id,
            owner: document.owner_id.to_string(),
            project_id: document.project_id,
            file_type: document.file_type,
            created_at: document.created_at,
            updated_at: document.updated_at,
        },
        Some(DocumentSubType::Task),
        Some(&supplement),
    )
    .unwrap();
    validate_soup_flat_v3(&projection).unwrap();
    assert!(projection.exact_facts.iter().any(|fact| {
        fact.attribute == vocabulary::importance() && fact.value == ExactValue::new([0]).unwrap()
    }));
    let statuses = projection
        .exact_facts
        .iter()
        .filter(|fact| fact.attribute == vocabulary::task_status_option())
        .map(|fact| fact.value.as_bytes())
        .collect::<Vec<_>>();
    assert_eq!(statuses, vec![status_a.as_bytes(), status_b.as_bytes()]);

    let mut missing_importance = projection;
    missing_importance
        .exact_facts
        .retain(|fact| fact.attribute != vocabulary::importance());
    assert!(matches!(
        validate_soup_flat_v3(&missing_importance),
        Err(ProfileValidationError::MissingRequired("importance"))
    ));
}

#[test]
fn supplement_decoder_rejects_unknown_oversized_and_trailing_frames() {
    assert!(matches!(
        decode_cache_projection_supplement(&STANDARD_NO_PAD.encode([0x03])),
        Err(SoupCacheProjectionWireError::UnsupportedWireVersion(0x03))
    ));
    assert!(matches!(
        decode_cache_projection_supplement(
            &"A".repeat(MAX_SOUP_CACHE_PROJECTION_ENCODED_BYTES + 1)
        ),
        Err(SoupCacheProjectionWireError::EncodedTooLarge)
    ));

    let supplement =
        SoupCacheProjectionSupplement::document_v2(document_key(Uuid::from_u128(1)), false);
    let encoded = encode_cache_projection_supplement(&supplement).unwrap();
    let mut framed = STANDARD_NO_PAD.decode(encoded).unwrap();
    framed.push(0);
    assert!(matches!(
        decode_cache_projection_supplement(&STANDARD_NO_PAD.encode(framed)),
        Err(SoupCacheProjectionWireError::TrailingBytes)
    ));
}

#[test]
fn supplement_decoder_rejects_invalid_profile_partition_and_record_binding() {
    let supplement =
        SoupCacheProjectionSupplement::document_v2(document_key(Uuid::from_u128(1)), false);
    let encode_unchecked = |capsule: &SoupCacheProjectionCapsuleV1| {
        let mut framed = vec![SOUP_CACHE_PROJECTION_WIRE_VERSION_V1];
        framed.extend(postcard::to_stdvec(capsule).unwrap());
        STANDARD_NO_PAD.encode(framed)
    };

    let mut unknown_profile = SoupCacheProjectionCapsuleV1::try_from(&supplement).unwrap();
    unknown_profile.target_profile = "soup-flat-v999".to_owned();
    assert!(matches!(
        decode_cache_projection_supplement(&encode_unchecked(&unknown_profile)),
        Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(_))
    ));

    let mut wrong_partition = SoupCacheProjectionCapsuleV1::try_from(&supplement).unwrap();
    wrong_partition.partition = "project".to_owned();
    assert!(matches!(
        decode_cache_projection_supplement(&encode_unchecked(&wrong_partition)),
        Err(SoupCacheProjectionWireError::UnsupportedPartition(_))
    ));

    let mut wrong_record = SoupCacheProjectionCapsuleV1::try_from(&supplement).unwrap();
    wrong_record.record_key = "GraphqlSoupProject:00000000-0000-0000-0000-000000000001".to_owned();
    assert!(matches!(
        decode_cache_projection_supplement(&encode_unchecked(&wrong_record)),
        Err(SoupCacheProjectionWireError::RecordKeyPartitionMismatch)
    ));
}
