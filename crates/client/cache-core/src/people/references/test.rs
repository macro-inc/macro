use super::*;
use crate::people::contact_key;

fn request(labels: &[&str], matching: ReferenceMatchMode) -> PeopleReferenceRequest {
    PeopleReferenceRequest {
        scope: HydrationScope {
            storage_generation: Uuid::from_u128(1),
            identity: "macro|viewer@example.com".into(),
        },
        labels: labels.iter().map(|label| (*label).into()).collect(),
        matching,
        exclude_secondary_inboxes: false,
    }
}

fn record(email: &str, name: Option<&str>) -> Record {
    Record {
        fields: [
            (
                "userId".into(),
                CacheValue::String(format!("macro|{email}")),
            ),
            ("email".into(), CacheValue::String(email.into())),
            (
                "name".into(),
                name.map_or(CacheValue::Null, |name| CacheValue::String(name.into())),
            ),
        ]
        .into(),
    }
}

fn push(collector: &mut ReferenceCollector<'_>, email: &str, name: Option<&str>) {
    let user = MacroUserIdStr::try_from_email(email).unwrap();
    let key = contact_key(&collector.request.scope.identity, user.as_ref());
    collector.push(&key, &record(email, name));
}

fn matches(collector: ReferenceCollector<'_>) -> Vec<PeopleReferenceMatch> {
    let PeopleReferenceResult::Resolved { matches, .. } = collector.finish().unwrap() else {
        panic!("expected completed matching")
    };
    matches
}

#[test]
fn name_modes_preserve_full_name_preference_and_property_ambiguity() {
    for (mode, count) in [
        (ReferenceMatchMode::Exact, 1),
        (ReferenceMatchMode::PreferFullName, 1),
        (ReferenceMatchMode::AnyName, 2),
    ] {
        let request = request(&[" Sam ", "sam", "Sam Jones", "missing"], mode);
        let mut collector = ReferenceCollector::new(&request, None).unwrap();
        push(&mut collector, "jones@example.com", Some("Sam Jones"));
        push(&mut collector, "baker@example.com", Some("Sam Baker"));
        push(&mut collector, "sam@example.com", Some("Sam"));
        let result = matches(collector);
        assert_eq!(result.len(), 4);
        assert_eq!(result[0].people.len(), count, "{mode:?}");
        assert_eq!(result[1].people.len(), count, "{mode:?}");
        assert_eq!(result[2].people[0].email, "jones@example.com");
        assert!(result[3].people.is_empty());
        assert!(result.iter().all(|result| result.complete));
    }
}

#[test]
fn full_directory_scan_retains_only_witnesses_and_can_replace_early_first_name_matches() {
    let request = request(&["Sam", "Late", "Sam"], ReferenceMatchMode::PreferFullName);
    let mut collector = ReferenceCollector::new(&request, None).unwrap();
    for index in 0..100_000 {
        let name = match index {
            99_998 => "Late".into(),
            99_999 => "Sam".into(),
            _ => format!("Sam {index}"),
        };
        push(
            &mut collector,
            &format!("person{index}@example.com"),
            Some(&name),
        );
        assert!(
            collector
                .evidence
                .iter()
                .all(|entry| entry.matched.people.len() <= 2)
        );
        assert_eq!(collector.by_label.len(), 2);
    }
    let result = matches(collector);
    assert_eq!(result[0].people.len(), 1);
    assert_eq!(result[0].people[0].email, "person99999@example.com");
    assert_eq!(result[1].people[0].email, "person99998@example.com");
    assert_eq!(result[2].people[0].email, "person99999@example.com");
}

#[test]
fn canonical_duplicates_do_not_create_ambiguity_and_missing_names_do_not_invent_first_names() {
    let request = request(
        &[
            "known@example.com",
            "macro|known@example.com",
            "Known",
            "noname",
            "noname@example.com",
        ],
        ReferenceMatchMode::PreferFullName,
    );
    let mut collector = ReferenceCollector::new(&request, None).unwrap();
    push(&mut collector, "KNOWN@example.com", Some("Known"));
    push(&mut collector, "known@example.com", Some("Known"));
    push(&mut collector, "noname@example.com", None);
    let result = matches(collector);
    assert!(result[..3].iter().all(|result| result.people.len() == 1));
    assert!(result[3].people.is_empty());
    assert_eq!(result[4].people.len(), 1);
}

#[test]
fn foreign_rows_cannot_change_reference_evidence_or_completeness() {
    let request = request(&["Sam", "Other"], ReferenceMatchMode::PreferFullName);
    let mut collector = ReferenceCollector::new(&request, None).unwrap();
    push(&mut collector, "sam@example.com", Some("Sam"));
    collector.push(
        &contact_key(
            "macro|other-viewer@example.com",
            "macro|foreign@example.com",
        ),
        &record("foreign@example.com", Some("Sam")),
    );
    push(&mut collector, "other@example.com", Some("Other"));
    let result = matches(collector);
    assert!(result[0].complete);
    assert_eq!(result[0].people.len(), 1);
    assert!(result[1].complete);
}

#[test]
fn unreadable_owned_names_make_uniqueness_evidence_incomplete() {
    for malformed in [false, true] {
        let request = request(&["Sam"], ReferenceMatchMode::PreferFullName);
        let mut collector = ReferenceCollector::new(&request, None).unwrap();
        push(&mut collector, "sam@example.com", Some("Sam"));
        let mut unknown = record("unknown@example.com", None);
        if malformed {
            unknown.fields.insert(
                "name".into(),
                CacheValue::Number(crate::value::CacheNumber::PosInt(1)),
            );
        } else {
            unknown.fields.remove("name");
        }
        collector.push(
            &contact_key(&request.scope.identity, "macro|unknown@example.com"),
            &unknown,
        );
        let result = matches(collector);
        assert_eq!(result[0].people.len(), 1, "malformed={malformed}");
        assert!(!result[0].complete, "malformed={malformed}");
    }
}

#[test]
fn exclusions_use_the_committed_epoch_and_corrupt_flags_remain_unknown() {
    let mut request = request(&["Sam", "Broken"], ReferenceMatchMode::PreferFullName);
    request.exclude_secondary_inboxes = true;
    let epoch = Uuid::from_u128(2);
    let mut collector = ReferenceCollector::new(&request, Some(epoch)).unwrap();
    let mut inbox = record("secondary@example.com", Some("Sam"));
    inbox.fields.insert(
        CONTEXT_FIELD.into(),
        CacheValue::opaque(
            &serde_json::to_value(StoredFacts {
                epoch,
                facts: super::super::PersonFacts {
                    secondary_inbox: true,
                    ..Default::default()
                },
            })
            .unwrap(),
        ),
    );
    collector.push(
        &contact_key(&request.scope.identity, "macro|secondary@example.com"),
        &inbox,
    );
    push(&mut collector, "sam@example.com", Some("Sam"));
    let mut broken = record("broken@example.com", Some("Broken"));
    broken
        .fields
        .insert(CONTEXT_FIELD.into(), CacheValue::String("corrupt".into()));
    collector.push(
        &contact_key(&request.scope.identity, "macro|broken@example.com"),
        &broken,
    );
    let result = matches(collector);
    assert_eq!(result[0].people.len(), 1);
    assert_eq!(result[0].people[0].email, "sam@example.com");
    assert!(!result[1].complete);
    assert!(result[1].people.is_empty());
}

#[test]
fn raw_input_bounds_apply_before_label_deduplication() {
    let mut request = request(&["Sam"], ReferenceMatchMode::Exact);
    request.labels = vec!["Sam".into(); MAX_PEOPLE_BATCH + 1];
    assert!(ReferenceCollector::new(&request, None).is_err());
    request.labels = vec!["é".repeat(257)];
    assert!(ReferenceCollector::new(&request, None).is_err());
    request.labels = vec![" ".into()];
    assert!(ReferenceCollector::new(&request, None).is_err());
}
