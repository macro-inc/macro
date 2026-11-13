use super::*;

fn filter(events: &[&str]) -> WebhookFilter {
    WebhookFilter {
        events: events.iter().map(|event| (*event).to_owned()).collect(),
        ids: None,
        entity_types: None,
    }
}

const DOC: FilterSubject<'static> = FilterSubject {
    event_name: "document.updated",
    entity_type: "document",
    entity_id: "doc-1",
};

#[test]
fn a_family_wildcard_matches_its_catalog_events_only_with_wildcards_on() {
    let wildcard = filter(&["document.*"]);

    assert!(wildcard.accepts(DOC, true));
    assert!(!wildcard.accepts(DOC, false), "literal without the flag");
    assert!(!filter(&["channel.*"]).accepts(DOC, true));
}

#[test]
fn star_matches_every_catalog_event_but_never_an_unregistered_name() {
    let star = filter(&["*"]);
    let unregistered = FilterSubject {
        event_name: "document.purged",
        ..DOC
    };

    assert!(star.accepts(DOC, true));
    assert!(!star.accepts(unregistered, true));
    assert!(!filter(&["document.*"]).accepts(unregistered, true));
}

#[test]
fn ids_and_entity_types_narrow_the_same_filter() {
    let mut narrowed = filter(&["message.posted"]);
    narrowed.entity_types = Some(vec!["document".to_owned()]);
    narrowed.ids = Some(vec!["doc-1".to_owned()]);
    let on_document = FilterSubject {
        event_name: "message.posted",
        entity_type: "document",
        entity_id: "doc-1",
    };

    assert!(narrowed.accepts(on_document, false));
    assert!(!narrowed.accepts(
        FilterSubject {
            entity_type: "channel",
            ..on_document
        },
        false
    ));
    assert!(!narrowed.accepts(
        FilterSubject {
            entity_id: "doc-2",
            ..on_document
        },
        false
    ));
}

#[test]
fn streams_cap_at_32_filters_and_webhooks_keep_50() {
    let filters = vec![filter(&["document.updated"]); MAX_WEBHOOK_FILTERS + 1];

    assert!(validate_filters(&filters[..MAX_STREAM_FILTERS], MAX_STREAM_FILTERS).is_ok());
    assert!(validate_filters(&filters[..MAX_STREAM_FILTERS + 1], MAX_STREAM_FILTERS).is_err());
    assert!(validate_filters(&filters[..MAX_WEBHOOK_FILTERS], MAX_WEBHOOK_FILTERS).is_ok());
    assert!(validate_filters(&filters, MAX_WEBHOOK_FILTERS).is_err());
    assert_eq!((MAX_STREAM_FILTERS, MAX_WEBHOOK_FILTERS), (32, 50));

    let mut ids = filter(&["document.updated"]);
    ids.ids = Some((0..=MAX_FILTER_IDS).map(|id| id.to_string()).collect());
    assert!(validate_filters(&[ids], MAX_STREAM_FILTERS).is_err());
}

#[test]
fn a_star_anywhere_but_a_whole_family_is_refused() {
    for pattern in ["doc*", "document.up*", "*.updated", "document.*.x", ".*"] {
        assert!(
            validate_filters(&[filter(&[pattern])], MAX_STREAM_FILTERS).is_err(),
            "{pattern} should be refused"
        );
    }
    for pattern in ["*", "document.*", "document.updated"] {
        assert!(
            validate_filters(&[filter(&[pattern])], MAX_STREAM_FILTERS).is_ok(),
            "{pattern}"
        );
    }
}

#[test]
fn entity_types_round_trip_and_stay_absent_when_unset() {
    let unset: WebhookFilter =
        serde_json::from_value(serde_json::json!({ "events": ["document.updated"] })).unwrap();
    assert_eq!(unset.entity_types, None);
    assert_eq!(
        serde_json::to_value(&unset).unwrap(),
        serde_json::json!({ "events": ["document.updated"] })
    );
}
