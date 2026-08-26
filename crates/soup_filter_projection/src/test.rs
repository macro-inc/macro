use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};
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

fn v2_document(
    id: Uuid,
    sub_type: Option<models_soup::document::SoupDocumentSubType>,
    is_email_attachment: bool,
) -> SoupProjectionHydration {
    SoupProjectionHydration {
        item: SoupItem::Document(SoupDocument {
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
        }),
        source: SoupProjectionSource::Document {
            is_email_attachment,
        },
    }
}

#[test]
fn v2_document_projection_has_explicit_attachment_and_canonical_subtype() {
    let hydration = v2_document(
        Uuid::from_u128(1),
        Some(models_soup::document::SoupDocumentSubType::Task { is_completed: true }),
        false,
    );
    let projection = project_soup_hydration(
        RecordKey::new("GraphqlSoupDocument:00000000-0000-0000-0000-000000000001").unwrap(),
        &hydration,
    )
    .unwrap()
    .unwrap();

    assert_eq!(projection.profile, vocabulary::profile_v2());
    assert!(projection.exact_facts.iter().any(|fact| {
        fact.attribute == vocabulary::email_attachment() && fact.value.as_bytes() == [0]
    }));
    assert!(projection.exact_facts.iter().any(|fact| {
        fact.attribute == vocabulary::document_sub_type() && fact.value.as_bytes() == b"task"
    }));
    validate_soup_flat_v2(&projection).unwrap();
}

#[test]
fn v2_profile_rejects_missing_or_duplicate_attachment_state() {
    let hydration = v2_document(Uuid::from_u128(1), None, false);
    let projection = project_soup_hydration(
        RecordKey::new("GraphqlSoupDocument:00000000-0000-0000-0000-000000000001").unwrap(),
        &hydration,
    )
    .unwrap()
    .unwrap();

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
fn capsule_v1_native_golden_round_trip_is_deterministic() {
    let id = Uuid::from_u128(1);
    let mut hydration = v2_document(id, None, false);
    let SoupItem::Document(document) = &mut hydration.item else {
        unreachable!()
    };
    document.created_at = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    document.updated_at = Utc.with_ymd_and_hms(2026, 1, 2, 0, 0, 0).unwrap();
    let projection = project_soup_hydration(
        RecordKey::new("GraphqlSoupDocument:00000000-0000-0000-0000-000000000001").unwrap(),
        &hydration,
    )
    .unwrap()
    .unwrap();

    let encoded = encode_cache_projection(&projection).unwrap();
    assert_eq!(
        encoded,
        "AQxzb3VwLWZsYXQtdjI4R3JhcGhxbFNvdXBEb2N1bWVudDowMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEIZG9jdW1lbnQEEGVtYWlsLWF0dGFjaG1lbnQBAAlmaWxlLXR5cGUCbWQCaWQQAAAAAAAAAAAAAAAAAAAAAQVvd25lchdtYWNyb3xvd25lckBleGFtcGxlLmNvbQIKY3JlYXRlZC1hdICAguKI0qMGCnVwZGF0ZWQtYXSAgL2/jNejBgIKY3JlYXRlZC1hdICAguKI0qMGCnVwZGF0ZWQtYXSAgL2/jNejBg"
    );
    assert_eq!(decode_cache_projection(&encoded).unwrap(), projection);
}

#[test]
fn capsule_decoder_rejects_unknown_oversized_and_trailing_frames() {
    assert!(matches!(
        decode_cache_projection(&STANDARD_NO_PAD.encode([0x02])),
        Err(SoupCacheProjectionWireError::UnsupportedWireVersion(0x02))
    ));
    assert!(matches!(
        decode_cache_projection(&"A".repeat(MAX_SOUP_CACHE_PROJECTION_ENCODED_BYTES + 1)),
        Err(SoupCacheProjectionWireError::EncodedTooLarge)
    ));

    let hydration = v2_document(Uuid::from_u128(1), None, false);
    let projection = project_soup_hydration(
        RecordKey::new("GraphqlSoupDocument:00000000-0000-0000-0000-000000000001").unwrap(),
        &hydration,
    )
    .unwrap()
    .unwrap();
    let encoded = encode_cache_projection(&projection).unwrap();
    let mut framed = STANDARD_NO_PAD.decode(encoded).unwrap();
    framed.push(0);
    assert!(matches!(
        decode_cache_projection(&STANDARD_NO_PAD.encode(framed)),
        Err(SoupCacheProjectionWireError::TrailingBytes)
    ));
}

#[test]
fn capsule_decoder_rejects_unknown_profile_and_invalid_subtype() {
    let hydration = v2_document(
        Uuid::from_u128(1),
        Some(models_soup::document::SoupDocumentSubType::Snippet {}),
        false,
    );
    let projection = project_soup_hydration(
        RecordKey::new("GraphqlSoupDocument:00000000-0000-0000-0000-000000000001").unwrap(),
        &hydration,
    )
    .unwrap()
    .unwrap();

    let encode_unchecked = |capsule: &SoupCacheProjectionCapsuleV1| {
        let mut framed = vec![SOUP_CACHE_PROJECTION_WIRE_VERSION];
        framed.extend(postcard::to_stdvec(capsule).unwrap());
        STANDARD_NO_PAD.encode(framed)
    };

    let mut unknown_profile = SoupCacheProjectionCapsuleV1::from(&projection);
    unknown_profile.profile = "soup-flat-v999".to_owned();
    assert!(matches!(
        decode_cache_projection(&encode_unchecked(&unknown_profile)),
        Err(SoupCacheProjectionWireError::ProfileValidation(
            ProfileValidationError::UnsupportedProfile(_)
        ))
    ));

    let mut invalid_subtype = SoupCacheProjectionCapsuleV1::from(&projection);
    invalid_subtype
        .exact_facts
        .iter_mut()
        .find(|fact| fact.attribute == "document-sub-type")
        .unwrap()
        .value = b"unknown".to_vec();
    assert!(matches!(
        decode_cache_projection(&encode_unchecked(&invalid_subtype)),
        Err(SoupCacheProjectionWireError::ProfileValidation(
            ProfileValidationError::InvalidValue("document-sub-type")
        ))
    ));
}
