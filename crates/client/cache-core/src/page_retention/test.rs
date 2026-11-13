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
fn contact_queries_share_the_page_budget_and_are_omitted_during_hydration() {
    let mut record = viewer();
    for n in 0..MAX_SOUP_PAGES * 2 {
        let field = ["contacts", "contactsByUserIds", "contactsByEmails", "soup"][n % 4];
        let mut update = viewer();
        update.fields.insert(format!("{field}({n})"), page());
        record.merge(update);
    }
    assert_eq!(
        record
            .fields
            .keys()
            .filter(|key| is_page_field(key))
            .count(),
        MAX_SOUP_PAGES
    );
    assert!(!record.fields.contains_key("contacts(0)"));
    record
        .fields
        .insert("contactsSettings".into(), CacheValue::Bool(true));
    let mut updates =
        RecordUpdates::from([(EntityKey::entity("GraphqlUser", &["viewer"]), record)]);
    omit_hydration_pages(&mut updates);
    let viewer = &updates[&EntityKey::entity("GraphqlUser", &["viewer"])];
    assert!(viewer.fields.keys().all(|key| !is_page_field(key)));
    assert_eq!(viewer.fields["contactsSettings"], CacheValue::Bool(true));
    assert!(!viewer.fields.contains_key(PAGE_ORDER_FIELD));
}

#[test]
fn combined_flat_and_grouped_pages_obey_encoded_byte_budget() {
    let mut record = viewer();
    for n in 0..MAX_SOUP_PAGES {
        record.fields.insert(
            format!("groupSoup({n})"),
            CacheValue::String("x".repeat(64 * 1024)),
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

#[test]
fn database_view_pages_share_retention_and_hydration_policy() {
    let initial = r#"databaseViewRows({"databaseId":"db","input":{"tableId":"table","query":{"sort":[]},"limit":500}})"#;
    let mut record = viewer();
    for cursor in 0..MAX_SOUP_PAGES * 2 {
        let mut update = viewer();
        update.fields.insert(format!(r#"databaseViewRows({{"databaseId":"db","input":{{"tableId":"table","query":{{"sort":[]}},"cursor":"{cursor:04}","limit":500}}}})"#), page());
        record.merge(update);
    }
    let mut update = viewer();
    update.fields.insert(initial.into(), page());
    record.merge(update);
    assert_eq!(
        record
            .fields
            .keys()
            .filter(|key| key.starts_with("databaseViewRows("))
            .count(),
        64
    );
    assert!(record.fields.contains_key(initial));
    let viewer_key = EntityKey("GraphqlUser:viewer".into());
    let mut updates = [(viewer_key.clone(), record)].into();
    omit_hydration_pages(&mut updates);
    assert_eq!(updates[&viewer_key], viewer());
}

fn channel_key(n: usize) -> String {
    format!("channelMessages({{\"channelId\":\"{:036}\"}})", n)
}
fn channel_page(n: usize) -> CacheValue {
    CacheValue::Ref(EntityKey(format!("GraphqlChannelMessages:{n:036}").into()))
}
fn count(record: &Record, is_field: fn(&str) -> bool) -> usize {
    record.fields.keys().filter(|key| is_field(key)).count()
}

#[test]
fn channel_pages_keep_the_latest_writes_within_their_own_budget() {
    let mut record = viewer();
    for n in 0..MAX_SOUP_PAGES {
        let mut update = viewer();
        update.fields.insert(key(n), page());
        record.merge(update);
    }
    for n in 0..MAX_CHANNEL_PAGES + 10 {
        let mut update = viewer();
        update.fields.insert(channel_key(n), channel_page(n));
        record.merge(update);
    }
    // Channel-sized links all fit the byte budget: the count is the bound.
    assert_eq!(count(&record, is_channel_page_field), MAX_CHANNEL_PAGES);
    assert!(!record.fields.contains_key(&channel_key(9)));
    assert!(record.fields.contains_key(&channel_key(10)));
    // Neither family pushes out the other.
    assert_eq!(count(&record, is_page_field), MAX_SOUP_PAGES);
    let mut update = viewer();
    update.fields.insert(key(MAX_SOUP_PAGES), page());
    record.merge(update);
    assert_eq!(count(&record, is_channel_page_field), MAX_CHANNEL_PAGES);
    assert!(record.fields.contains_key(&channel_key(10)));
    assert_eq!(record.fields["emailLinks"], viewer().fields["emailLinks"]);
}

#[test]
fn rewriting_a_channel_page_makes_it_the_newest_across_reopen() {
    let mut record = viewer();
    for n in 0..MAX_CHANNEL_PAGES {
        let mut update = viewer();
        update.fields.insert(channel_key(n), channel_page(n));
        record.merge(update);
    }
    let mut reopened = crate::codec::decode_record(&encode_record(&record)).unwrap();
    assert!(!compact_soup_pages(&mut reopened));
    let mut rewrite = viewer();
    rewrite.fields.insert(channel_key(0), channel_page(0));
    reopened.merge(rewrite);
    let mut next = viewer();
    next.fields.insert(channel_key(9999), channel_page(9999));
    reopened.merge(next);
    assert!(reopened.fields.contains_key(&channel_key(0)));
    assert!(!reopened.fields.contains_key(&channel_key(1)));
}

#[test]
fn an_incoming_snapshot_does_not_replace_channel_page_recency() {
    let mut record = viewer();
    for n in 0..3 {
        let mut update = viewer();
        update.fields.insert(channel_key(n), channel_page(n));
        record.merge(update);
    }
    let before = record.fields[CHANNEL_PAGE_ORDER_FIELD].clone();
    let mut snapshot = viewer();
    snapshot.fields.insert(
        CHANNEL_PAGE_ORDER_FIELD.into(),
        CacheValue::List(vec![CacheValue::String(channel_key(0))]),
    );
    assert!(!record.merge(snapshot));
    assert_eq!(record.fields[CHANNEL_PAGE_ORDER_FIELD], before);
    assert_eq!(count(&record, is_channel_page_field), 3);
}

#[test]
fn legacy_channel_pages_are_compacted_and_survive_hydration() {
    let mut record = viewer();
    for n in 0..MAX_CHANNEL_PAGES + 100 {
        record.fields.insert(channel_key(n), channel_page(n));
    }
    record.fields.insert(key(0), page());
    assert!(compact_soup_pages(&mut record));
    assert!(!compact_soup_pages(&mut record));
    assert_eq!(count(&record, is_channel_page_field), MAX_CHANNEL_PAGES);
    // An embedded page bigger than the whole budget is dropped, not kept.
    let mut update = viewer();
    update.fields.insert(
        channel_key(5000),
        CacheValue::String("x".repeat(MAX_CHANNEL_PAGE_BYTES)),
    );
    record.merge(update);
    assert!(!record.fields.contains_key(&channel_key(5000)));
    let viewer_key = EntityKey("GraphqlUser:viewer".into());
    let mut updates = [(viewer_key.clone(), record.clone())].into();
    omit_hydration_pages(&mut updates);
    let hydrated = &updates[&viewer_key];
    assert_eq!(count(hydrated, is_page_field), 0);
    assert_eq!(count(hydrated, is_channel_page_field), MAX_CHANNEL_PAGES);
    assert_eq!(
        hydrated.fields[CHANNEL_PAGE_ORDER_FIELD],
        record.fields[CHANNEL_PAGE_ORDER_FIELD]
    );
}
