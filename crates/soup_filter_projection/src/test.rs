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
        }),
    }
}

fn document_key(id: Uuid) -> RecordKey {
    RecordKey::new(format!("GraphqlSoupDocument:{id}")).unwrap()
}

fn composed_v2_document(
    id: Uuid,
    sub_type: Option<&str>,
    is_email_attachment: bool,
) -> IndexDocument {
    let mut projection = project_document(document_key(id), &document(id, None)).unwrap();
    projection.profile = vocabulary::profile_v2();
    projection.exact_facts.push(ExactFact {
        attribute: vocabulary::email_attachment(),
        value: ExactValue::new(vec![u8::from(is_email_attachment)]).unwrap(),
    });
    if let Some(sub_type) = sub_type {
        projection.exact_facts.push(ExactFact {
            attribute: vocabulary::document_sub_type(),
            value: ExactValue::utf8(sub_type).unwrap(),
        });
    }
    projection.canonicalize();
    projection
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

    assert_eq!(supplement.target_profile(), &vocabulary::profile_v2());
    assert_eq!(supplement.partition(), &vocabulary::document_partition());
    assert_eq!(supplement.record_key(), &document_key(id));
    assert!(!supplement.is_email_attachment());

    let wire = SoupCacheProjectionCapsuleV1::from(&supplement);
    assert_eq!(wire.target_profile, "soup-flat-v2");
    assert_eq!(wire.partition, "document");
    assert!(!wire.is_email_attachment);
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
fn complete_v2_validation_remains_separate_from_the_supplement() {
    let projection = composed_v2_document(Uuid::from_u128(1), Some("task"), false);
    validate_soup_flat_v2(&projection).unwrap();

    let mut missing = projection.clone();
    missing
        .exact_facts
        .retain(|fact| fact.attribute != vocabulary::email_attachment());
    assert!(matches!(
        validate_soup_flat_v2(&missing),
        Err(ProfileValidationError::MissingRequired("email-attachment"))
    ));

    let mut duplicate = projection;
    duplicate.exact_facts.push(ExactFact {
        attribute: vocabulary::email_attachment(),
        value: ExactValue::new(vec![1]).unwrap(),
    });
    assert!(matches!(
        validate_soup_flat_v2(&duplicate),
        Err(ProfileValidationError::Duplicate("email-attachment"))
    ));
}

#[test]
fn supplement_capsule_v1_native_golden_round_trip_is_deterministic() {
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
        "AQxzb3VwLWZsYXQtdjI4R3JhcGhxbFNvdXBEb2N1bWVudDowMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEIZG9jdW1lbnQA"
    );
    assert_eq!(
        decode_cache_projection_supplement(&encoded).unwrap(),
        supplement
    );
}

#[test]
fn supplement_decoder_rejects_unknown_oversized_and_trailing_frames() {
    assert!(matches!(
        decode_cache_projection_supplement(&STANDARD_NO_PAD.encode([0x02])),
        Err(SoupCacheProjectionWireError::UnsupportedWireVersion(0x02))
    ));
    assert!(matches!(
        decode_cache_projection_supplement(
            &"A".repeat(MAX_SOUP_CACHE_PROJECTION_ENCODED_BYTES + 1)
        ),
        Err(SoupCacheProjectionWireError::EncodedTooLarge)
    ));

    let supplement =
        SoupCacheProjectionSupplement::document(document_key(Uuid::from_u128(1)), false);
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
        SoupCacheProjectionSupplement::document(document_key(Uuid::from_u128(1)), false);
    let encode_unchecked = |capsule: &SoupCacheProjectionCapsuleV1| {
        let mut framed = vec![SOUP_CACHE_PROJECTION_WIRE_VERSION];
        framed.extend(postcard::to_stdvec(capsule).unwrap());
        STANDARD_NO_PAD.encode(framed)
    };

    let mut unknown_profile = SoupCacheProjectionCapsuleV1::from(&supplement);
    unknown_profile.target_profile = "soup-flat-v999".to_owned();
    assert!(matches!(
        decode_cache_projection_supplement(&encode_unchecked(&unknown_profile)),
        Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(_))
    ));

    let mut wrong_partition = SoupCacheProjectionCapsuleV1::from(&supplement);
    wrong_partition.partition = "project".to_owned();
    assert!(matches!(
        decode_cache_projection_supplement(&encode_unchecked(&wrong_partition)),
        Err(SoupCacheProjectionWireError::UnsupportedPartition(_))
    ));

    let mut wrong_record = SoupCacheProjectionCapsuleV1::from(&supplement);
    wrong_record.record_key = "GraphqlSoupProject:00000000-0000-0000-0000-000000000001".to_owned();
    assert!(matches!(
        decode_cache_projection_supplement(&encode_unchecked(&wrong_record)),
        Err(SoupCacheProjectionWireError::RecordKeyPartitionMismatch)
    ));
}
