use super::*;
use serde_json::{from_value, json, to_value};

fn conversation() -> ConversationId {
    "C012ABC".parse().unwrap()
}

fn descriptor(index: u32) -> UploadDescriptor {
    UploadDescriptor {
        upload: UploadId::ConversationPart {
            slack_channel_id: conversation(),
            part_index: index,
        },
        sha256: "a".repeat(64).parse().unwrap(),
        byte_length: 100,
        record_count: Some(2),
    }
}

#[test]
fn uuid_ids_validate_on_construction_and_deserialization() {
    for invalid in [
        "",
        "not-a-uuid",
        "00000000-0000-0000-0000-000000000000",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ] {
        assert!(invalid.parse::<JobId>().is_err());
        assert!(from_value::<JobId>(json!(invalid)).is_err());
        assert!(invalid.parse::<CreateToken>().is_err());
        assert!(invalid.parse::<LeaseToken>().is_err());
        assert!(invalid.parse::<TeamId>().is_err());
        assert!(invalid.parse::<WorkerId>().is_err());
    }
    let uuid = Uuid::now_v7();
    let job = JobId::try_from(uuid).unwrap();
    assert_eq!(Uuid::from(job), uuid);
    assert_eq!(from_value::<JobId>(to_value(job).unwrap()).unwrap(), job);
}

#[test]
fn source_ids_are_typed_and_path_safe() {
    for valid in ["C012AB", "G012AB", "D012AB"] {
        assert!(valid.parse::<ConversationId>().is_ok());
    }
    for invalid in [
        "", "C", "c012", "T012", "C/123", "C..", "C%2F", "Cλ", "C123\n",
    ] {
        assert!(invalid.parse::<ConversationId>().is_err());
        assert!(from_value::<ConversationId>(json!(invalid)).is_err());
    }
    assert!(
        format!("C{}", "1".repeat(64))
            .parse::<ConversationId>()
            .is_err()
    );
    assert!("T012ABC".parse::<SourceId>().is_ok());
    assert!("E012ABC".parse::<SourceId>().is_err());
    assert!("C012ABC".parse::<SourceId>().is_err());
    for valid in ["U012ABC", "W012ABC", "USLACKBOT"] {
        assert!(valid.parse::<SlackUserId>().is_ok());
    }
    assert!("T012ABC".parse::<SlackUserId>().is_err());
}

#[test]
fn key_segments_and_server_keys_reject_traversal() {
    for invalid in [
        "",
        ".",
        "..",
        "../channel",
        "a/b",
        "a\\b",
        "a\0b",
        "a\nb",
        "%2e%2e",
        "a%2fb",
    ] {
        assert!(invalid.parse::<KeySegment>().is_err(), "{invalid:?}");
        assert!(from_value::<KeySegment>(json!(invalid)).is_err());
    }
    assert!("a".repeat(256).parse::<KeySegment>().is_err());
    assert!("engineering team-2026".parse::<KeySegment>().is_ok());
    assert!("slack/jobs/C123/0.ndjson".parse::<ObjectKey>().is_ok());
    for invalid in ["/absolute", "a//b", "a/../b", "a/./b", "a/", "a/%2f/b"] {
        assert!(invalid.parse::<ObjectKey>().is_err());
    }
}

#[test]
fn timestamps_preserve_microseconds_without_floats() {
    let earlier: SlackTimestamp = "1727711111.000001".parse().unwrap();
    let later: SlackTimestamp = "1727711111.000002".parse().unwrap();
    assert_eq!(earlier.unix_micros(), 1_727_711_111_000_001);
    assert_eq!(later.unix_micros() - earlier.unix_micros(), 1);
    assert!(later > earlier);
    assert_eq!(to_value(earlier).unwrap(), json!("1727711111.000001"));
    assert_eq!(
        "0001.1".parse::<SlackTimestamp>().unwrap().to_string(),
        "1.100000"
    );
    let max: SlackTimestamp = "253402300799.999999".parse().unwrap();
    assert_eq!(max.to_string(), "253402300799.999999");
    assert_eq!(
        from_value::<SlackTimestamp>(to_value(max).unwrap()).unwrap(),
        max
    );
    assert_eq!("0.0".parse::<SlackTimestamp>().unwrap().unix_micros(), 0);
}

#[test]
fn timestamps_reject_lossy_or_invalid_forms() {
    for invalid in [
        "",
        "1",
        "1.",
        ".1",
        "-1.000001",
        "+1.0",
        "1.0000001",
        "1.1.1",
        "1e3.1",
        "NaN",
        "1. 1",
        "253402300800.0",
        "999999999999999999999.0",
    ] {
        assert!(invalid.parse::<SlackTimestamp>().is_err(), "{invalid}");
        assert!(from_value::<SlackTimestamp>(json!(invalid)).is_err());
    }
    assert!(from_value::<SlackTimestamp>(json!(1727711111.000001_f64)).is_err());
}

#[test]
fn digest_is_exact_lowercase_sha256() {
    assert!("f".repeat(64).parse::<Sha256Digest>().is_ok());
    for invalid in [
        "F".repeat(64),
        "g".repeat(64),
        "a".repeat(63),
        "a".repeat(65),
    ] {
        assert!(invalid.parse::<Sha256Digest>().is_err());
    }
}

#[test]
fn status_wire_names_are_stable() {
    for (status, wire) in [
        (JobStatus::Uploading, "uploading"),
        (JobStatus::Processing, "processing"),
        (JobStatus::Completed, "completed"),
        (JobStatus::CompletedWithErrors, "completed_with_errors"),
        (JobStatus::Failed, "failed"),
        (JobStatus::Cancelling, "cancelling"),
        (JobStatus::Cancelled, "cancelled"),
    ] {
        assert_eq!(to_value(status).unwrap(), json!(wire));
        assert_eq!(from_value::<JobStatus>(json!(wire)).unwrap(), status);
    }
    for (status, wire) in [
        (ConversationStatus::AwaitingUploads, "awaiting_uploads"),
        (ConversationStatus::Queued, "queued"),
        (ConversationStatus::Importing, "importing"),
        (ConversationStatus::Completed, "completed"),
        (ConversationStatus::Skipped, "skipped"),
        (ConversationStatus::Failed, "failed"),
    ] {
        assert_eq!(to_value(status).unwrap(), json!(wire));
        assert_eq!(
            from_value::<ConversationStatus>(json!(wire)).unwrap(),
            status
        );
    }
    assert!(from_value::<JobStatus>(json!("done")).is_err());
}

#[test]
fn zero_part_seal_is_explicit_and_deterministic() {
    let seal =
        ConversationSeal::from_descriptors(conversation(), &[], &ImportLimits::default()).unwrap();
    assert_eq!(
        to_value(&seal).unwrap(),
        json!({
            "slackChannelId": "C012ABC", "partCount": 0,
            "manifestSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        })
    );
    let completion = CompleteUploads {
        uploads: vec![],
        seal: Some(seal),
    };
    assert_eq!(
        from_value::<CompleteUploads>(to_value(&completion).unwrap()).unwrap(),
        completion
    );
    assert_ne!(
        to_value(Some(0_u32)).unwrap(),
        to_value(None::<u32>).unwrap()
    );
}

#[test]
fn manifest_hash_is_canonical_and_registration_order_independent() {
    let limits = ImportLimits::default();
    let seal = ConversationSeal::from_descriptors(
        conversation(),
        &[descriptor(1), descriptor(0)],
        &limits,
    )
    .unwrap();
    let ordered = ConversationSeal::from_descriptors(
        conversation(),
        &[descriptor(0), descriptor(1)],
        &limits,
    )
    .unwrap();
    assert_eq!(seal, ordered);
    let canonical = format!("0:{}:100:2\n1:{}:100:2\n", "a".repeat(64), "a".repeat(64));
    assert_eq!(
        seal.manifest_sha256.as_str(),
        format!("{:x}", Sha256::digest(canonical))
    );
    let mut changed = descriptor(1);
    changed.byte_length += 1;
    assert_ne!(
        seal,
        ConversationSeal::from_descriptors(conversation(), &[descriptor(0), changed], &limits)
            .unwrap()
    );
}

#[test]
fn manifests_reject_gaps_duplicates_wrong_conversations_and_users() {
    let limits = ImportLimits::default();
    for parts in [
        vec![descriptor(1)],
        vec![descriptor(0), descriptor(0)],
        vec![descriptor(0), descriptor(2)],
    ] {
        assert_eq!(
            ConversationSeal::from_descriptors(conversation(), &parts, &limits),
            Err(ValidationError::InvalidManifest)
        );
    }
    assert!(
        ConversationSeal::from_descriptors("COTHER".parse().unwrap(), &[descriptor(0)], &limits)
            .is_err()
    );
    let mut users = descriptor(0);
    users.upload = UploadId::Users;
    users.record_count = None;
    assert!(users.validate(&limits).is_ok());
    assert_eq!(
        ConversationSeal::from_descriptors(conversation(), &[users], &limits),
        Err(ValidationError::InvalidManifest)
    );
}

#[test]
fn descriptors_enforce_byte_and_record_bounds() {
    let limits = ImportLimits::default();
    let mut part = descriptor(0);
    for bytes in [0, limits.part_bytes + 1] {
        part.byte_length = bytes;
        assert!(part.validate(&limits).is_err());
    }
    part.byte_length = limits.part_bytes;
    part.record_count = Some(limits.part_records);
    assert!(part.validate(&limits).is_ok());
    for count in [None, Some(0), Some(limits.part_records + 1)] {
        part.record_count = count;
        assert!(part.validate(&limits).is_err());
    }
    let small = ImportLimits {
        selected_bytes: 199,
        ..limits
    };
    assert_eq!(
        ConversationSeal::from_descriptors(conversation(), &[descriptor(0), descriptor(1)], &small),
        Err(ValidationError::LimitExceeded)
    );
    part.upload = UploadId::Users;
    part.record_count = None;
    part.byte_length = limits.json_bytes;
    assert!(part.validate(&limits).is_ok());
    part.byte_length += 1;
    assert!(part.validate(&limits).is_err());
}

#[test]
fn create_requires_explicit_source_confirmation_and_full_metadata() {
    let command = json!({
        "idempotencyToken": Uuid::now_v7(),
        "source": { "kind": "confirmed_unknown" },
        "includeMessageHistory": false,
        "conversations": [{
            "slackChannelId": "C012ABC", "kind": "public_channel", "name": "general",
            "folder": "general", "memberIds": ["U012ABC"], "creatorId": null,
            "createdAt": null, "archived": false, "messageCount": null
        }]
    });
    let create: CreateImport = from_value(command.clone()).unwrap();
    assert_eq!(create.source, SourceIdentity::ConfirmedUnknown);
    assert_eq!(to_value(&create).unwrap(), command);
    let mut missing = command.clone();
    missing["conversations"][0]
        .as_object_mut()
        .unwrap()
        .remove("memberIds");
    assert!(from_value::<CreateImport>(missing).is_err());
    let mut missing = command.clone();
    missing.as_object_mut().unwrap().remove("source");
    assert!(from_value::<CreateImport>(missing).is_err());
    let mut injected = command;
    injected["teamId"] = json!(Uuid::now_v7());
    assert!(from_value::<CreateImport>(injected).is_err());
}

#[test]
fn queue_messages_cannot_smuggle_storage_keys_or_authority() {
    let event = ImportEvent {
        job_id: Uuid::now_v7().try_into().unwrap(),
        slack_channel_id: conversation(),
        generation: 1,
    };
    let encoded = to_value(&event).unwrap();
    assert_eq!(encoded.as_object().unwrap().len(), 3);
    assert_eq!(from_value::<ImportEvent>(encoded.clone()).unwrap(), event);
    for forbidden in ["key", "s3Key", "teamId", "leaseToken"] {
        let mut injected = encoded.clone();
        injected[forbidden] = json!("untrusted");
        assert!(from_value::<ImportEvent>(injected).is_err());
    }
}

#[test]
fn verified_object_validators_are_nonempty_and_do_not_claim_to_be_checksums() {
    for invalid in ["", "version\n", "tag\0"] {
        assert!(invalid.parse::<ObjectValidator>().is_err());
    }
    assert!("v".repeat(1025).parse::<ObjectValidator>().is_err());
    let tag: ObjectValidator = "\"opaque-multipart-2\"".parse().unwrap();
    assert!(tag.as_str().parse::<Sha256Digest>().is_err());
    assert!(matches!(
        ObjectIdentity::EntityTag(tag),
        ObjectIdentity::EntityTag(_)
    ));
}

#[test]
fn diagnostics_and_search_receipts_have_sanitized_stable_shapes() {
    assert_eq!(
        to_value(ImportError::UploadMismatch).unwrap(),
        json!("upload_mismatch")
    );
    assert_eq!(ImportError::Unavailable.to_string(), "import unavailable");
    let receipt = Uuid::now_v7();
    assert_eq!(
        to_value(SearchState::Submitted {
            receipt_id: receipt
        })
        .unwrap(),
        json!({ "status": "submitted", "receiptId": receipt })
    );
    assert_eq!(
        to_value(SourceIdentity::Known {
            source_id: "T012ABC".parse().unwrap()
        })
        .unwrap(),
        json!({ "kind": "known", "sourceId": "T012ABC" })
    );
}
