use super::*;
use crate::codec::encode_record;
use crate::value::EntityKey;

fn viewer() -> Record {
    Record {
        fields: [
            (
                "__typename".into(),
                CacheValue::String(SOUP_PAGE_OWNER.into()),
            ),
            ("id".into(), CacheValue::String("viewer".into())),
            (
                "emailLinks".into(),
                CacheValue::List(vec![CacheValue::Ref(EntityKey("EmailLink:one".into()))]),
            ),
        ]
        .into(),
    }
}

fn key(n: usize) -> String {
    format!("soup({{\"input\":{{\"continuation\":{{\"cursor\":\"{n:04}\"}}}}}})")
}
fn page() -> CacheValue {
    CacheValue::Object(
        [(
            "items".into(),
            CacheValue::List(vec![CacheValue::Ref(EntityKey(
                "GraphqlSoupDocument:one".into(),
            ))]),
        )]
        .into(),
    )
}

#[test]
fn retains_recent_writes_across_reopen_and_keeps_non_page_fields() {
    let mut record = viewer();
    for n in 0..MAX_SOUP_PAGES * 2 {
        let mut update = viewer();
        update.fields.insert(key(n), page());
        record.merge(update);
    }
    assert!(!record.fields.contains_key(&key(0)));
    assert!(record.fields.contains_key(&key(MAX_SOUP_PAGES * 2 - 1)));
    assert_eq!(
        record
            .fields
            .keys()
            .filter(|key| is_page_field(key))
            .count(),
        MAX_SOUP_PAGES
    );
    assert_eq!(record.fields["emailLinks"], viewer().fields["emailLinks"]);
    let mut reopened = crate::codec::decode_record(&encode_record(&record)).unwrap();
    assert!(!compact_soup_pages(&mut reopened));
    let mut update = viewer();
    update.fields.insert(key(MAX_SOUP_PAGES), page());
    reopened.merge(update.clone());
    assert!(!reopened.merge(update));
    let mut next = viewer();
    next.fields.insert(key(9999), page());
    reopened.merge(next);
    assert!(reopened.fields.contains_key(&key(MAX_SOUP_PAGES)));
    assert!(!reopened.fields.contains_key(&key(MAX_SOUP_PAGES + 1)));
}

#[test]
fn combined_flat_and_grouped_pages_obey_encoded_byte_budget() {
    let mut record = viewer();
    for n in 0..MAX_SOUP_PAGES {
        record.fields.insert(
            format!("groupSoup({n})"),
            CacheValue::String("x".repeat(32 * 1024)),
        );
    }
    record.fields.insert(key(0), page());
    assert!(compact_soup_pages(&mut record));
    assert!(encode_record(&record).len() < MAX_SOUP_PAGE_BYTES + 256);
    assert!(
        record
            .fields
            .keys()
            .filter(|key| is_page_field(key))
            .count()
            < MAX_SOUP_PAGES
    );
    // An individually oversized page is disposable, but does not evict every
    // useful smaller page or an unrelated field with a similar name.
    let mut update = viewer();
    update.fields.insert(
        key(999),
        CacheValue::String("x".repeat(MAX_SOUP_PAGE_BYTES)),
    );
    update
        .fields
        .insert("soupSettings".into(), CacheValue::Bool(true));
    record.merge(update);
    assert!(!record.fields.contains_key(&key(999)));
    assert_eq!(record.fields["soupSettings"], CacheValue::Bool(true));
    assert!(record.fields.keys().any(|key| is_page_field(key)));
}

#[test]
fn legacy_compaction_prefers_initial_pages_and_is_idempotent() {
    let mut record = viewer();
    for n in 0..5000 {
        record.fields.insert(key(n), page());
    }
    let initial = "soup({\"input\":{\"initial\":{\"limit\":50}}})";
    record.fields.insert(initial.into(), page());
    assert!(compact_soup_pages(&mut record));
    assert!(record.fields.contains_key(initial));
    assert!(!compact_soup_pages(&mut record));
    assert_eq!(
        record
            .fields
            .keys()
            .filter(|key| is_page_field(key))
            .count(),
        MAX_SOUP_PAGES
    );
}

#[test]
fn hydration_drops_only_viewer_pages_not_children_or_other_relations() {
    let mut user = viewer();
    user.fields.insert(key(1), page());
    let mut child = Record::default();
    child.fields.insert(
        "__typename".into(),
        CacheValue::String("GraphqlSoupEmailThread".into()),
    );
    child
        .fields
        .insert("messages({\"offset\":0,\"limit\":20})".into(), page());
    let mut updates = [
        (EntityKey("GraphqlUser:viewer".into()), user),
        (
            EntityKey("GraphqlSoupEmailThread:one".into()),
            child.clone(),
        ),
    ]
    .into();
    omit_hydration_pages(&mut updates);
    assert_eq!(updates[&EntityKey("GraphqlUser:viewer".into())], viewer());
    assert_eq!(
        updates[&EntityKey("GraphqlSoupEmailThread:one".into())],
        child
    );
}
