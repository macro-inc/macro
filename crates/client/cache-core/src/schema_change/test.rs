use super::*;
use crate::queue::{OptimisticSource, decode_optimistic_source};

fn schema(sdl: &str) -> Arc<Schema> {
    Schema::from_sdl(sdl).unwrap()
}

fn classify(old: &str, new: &str) -> SchemaChange {
    classify_reading(old, new, &ProjectionInputs::none())
}

fn classify_reading(old: &str, new: &str, inputs: &ProjectionInputs) -> SchemaChange {
    SchemaChange::classify(Some(&schema(old)), &schema(new), inputs)
}

fn types(names: &[&str], every_document: bool) -> Tier {
    Tier::Types {
        changed: names.iter().map(|name| (*name).to_owned()).collect(),
        every_document,
    }
}

const THREAD: &str = "type Query { thread: Thread } type Thread { id: ID! subject: String }";

#[test]
fn the_same_schema_is_compatible_and_stored_as_it_is() {
    let bundled = crate::meta::bundled_schema();
    let change = SchemaChange::classify(Some(&bundled), &bundled, &ProjectionInputs::every());
    assert_eq!(change.tier, Tier::Compatible);
    assert_eq!(change.stored.hash(), bundled.hash());
}

#[test]
fn additions_and_widenings_are_compatible() {
    for new in [
        "type Query { thread: Thread } type Thread { id: ID! subject: String count: Int }",
        "type Query { thread: Thread other: Other } type Thread { id: ID! subject: String } type Other { name: String }",
        "type Query { thread: Thread } type Thread { id: ID! subject: ID }",
    ] {
        let change = classify(THREAD, new);
        assert_eq!(change.tier, Tier::Compatible, "{new}");
        assert_eq!(change.stored.hash(), schema(new).hash(), "{new}");
    }
    let change = classify(
        "type Query { t: Thread } type Thread { id: ID! count: Int! tags: [String!]! }",
        "type Query { t: Thread } type Thread { id: ID! count: Float tags: [String] }",
    );
    assert_eq!(change.tier, Tier::Compatible);
    let change = classify(
        "type Query { item: Item } union Item = A type A { id: ID! } type B { id: ID! }",
        "type Query { item: Item } union Item = A | B type A { id: ID! } type B { id: ID! }",
    );
    assert_eq!(change.tier, Tier::Compatible);
}

#[test]
fn a_removed_field_nothing_reads_is_compatible_and_remembered() {
    let removed = "type Query { thread: Thread } type Thread { id: ID! }";
    let change = classify(THREAD, removed);
    assert_eq!(change.tier, Tier::Compatible);
    let kept = change.stored.field_meta("Thread", "subject").unwrap();
    assert_eq!(kept.ty.name, "String");

    // Added back as it was, the stored values still fit.
    let again = SchemaChange::classify(
        Some(&change.stored),
        &schema(THREAD),
        &ProjectionInputs::none(),
    );
    assert_eq!(again.tier, Tier::Compatible);
    // Added back as another type, they do not.
    let other = SchemaChange::classify(
        Some(&change.stored),
        &schema("type Query { thread: Thread } type Thread { id: ID! subject: Int }"),
        &ProjectionInputs::none(),
    );
    assert_eq!(other.tier, types(&["Thread"], false));
    // Dropping the records forgets the removed field.
    assert_eq!(
        other
            .stored
            .field_meta("Thread", "subject")
            .unwrap()
            .ty
            .name,
        "Int"
    );
}

#[test]
fn a_removed_type_nothing_reads_is_remembered_until_it_changes() {
    let old = "type Query { thread: Thread note: Note } type Thread { id: ID! } type Note { id: ID! body: String }";
    let new = "type Query { thread: Thread } type Thread { id: ID! }";
    let change = classify(old, new);
    assert_eq!(change.tier, Tier::Compatible);
    assert!(change.stored.type_meta("Note").is_some());
    assert!(change.stored.field_meta("Query", "note").is_some());

    // The root's removed field names the dropped type, so the root goes too.
    let read = classify_reading(old, new, &ProjectionInputs::none().own("Note", &["body"]));
    assert_eq!(read.tier, types(&["Note", "ROOT_QUERY"], false));
    assert!(read.stored.type_meta("Note").is_none());
    assert!(read.stored.field_meta("Query", "note").is_none());
}

#[test]
fn a_removed_field_a_projection_reads_changes_its_type() {
    let removed = "type Query { thread: Thread } type Thread { id: ID! }";
    let own = ProjectionInputs::none().own("Thread", &["subject"]);
    assert_eq!(
        classify_reading(THREAD, removed, &own).tier,
        types(&["Thread"], false)
    );
    let nested = ProjectionInputs::none().nested("Thread", &["subject"]);
    assert_eq!(
        classify_reading(THREAD, removed, &nested).tier,
        types(&["Thread"], true)
    );
    let other = ProjectionInputs::none().own("Thread", &["id"]);
    assert_eq!(
        classify_reading(THREAD, removed, &other).tier,
        Tier::Compatible
    );
    assert_eq!(
        classify_reading(THREAD, removed, &ProjectionInputs::every()).tier,
        types(&["Thread"], true)
    );
}

#[test]
fn narrowed_or_retyped_fields_change_their_type() {
    for new in [
        "type Query { thread: Thread } type Thread { id: ID! subject: String! }",
        "type Query { thread: Thread } type Thread { id: ID! subject: Int }",
        "type Query { thread: Thread } type Thread { id: ID! subject: [String] }",
        "type Query { thread: Thread } type Thread { id: ID! subject: Kind } enum Kind { A }",
        "type Query { thread: Thread } type Thread { id: ID! subject: JSON } scalar JSON",
    ] {
        assert_eq!(
            classify(THREAD, new).tier,
            types(&["Thread"], false),
            "{new}"
        );
    }
    let enums = classify(
        "type Query { t: Thread } type Thread { id: ID! kind: Kind } enum Kind { A }",
        "type Query { t: Thread } type Thread { id: ID! kind: Other } enum Other { A }",
    );
    assert_eq!(enums.tier, types(&["Thread"], false));
}

#[test]
fn a_changed_entity_keeps_the_records_that_reference_it() {
    let change = classify(
        "type Query { thread: Thread } type Thread { id: ID! author: User } type User { id: ID! name: String }",
        "type Query { thread: Thread } type Thread { id: ID! author: User } type User { id: ID! name: Int }",
    );
    assert_eq!(change.tier, types(&["User"], false));
    let rekeyed = classify(
        "type Query { thread: Thread } type Thread { id: ID! author: User } type User { id: ID! }",
        "type Query { thread: Thread } type Thread { id: ID! author: User } type User { name: String }",
    );
    assert_eq!(rekeyed.tier, types(&["Thread", "User"], false));
}

#[test]
fn a_changed_embedded_type_changes_every_record_holding_it() {
    let change = classify(
        "type Query { thread: Thread pin: Pin } type Thread { id: ID! pin: Pin } type Pin { at: Time } type Time { ms: Int }",
        "type Query { thread: Thread pin: Pin } type Thread { id: ID! pin: Pin } type Pin { at: Time } type Time { ms: String }",
    );
    assert_eq!(
        change.tier,
        types(&["Pin", "ROOT_QUERY", "Thread", "Time"], false)
    );
}

#[test]
fn a_union_that_loses_a_member_changes_its_holders() {
    let change = classify(
        "type Query { thread: Thread } type Thread { id: ID! item: Item } union Item = A | B type A { id: ID! } type B { id: ID! }",
        "type Query { thread: Thread } type Thread { id: ID! item: Item } union Item = A type A { id: ID! } type B { id: ID! }",
    );
    assert_eq!(change.tier, types(&["Item", "Thread"], false));
}

#[test]
fn a_projected_embedded_type_that_loses_a_field_changes_its_holder() {
    let old = "type Query { thread: Thread } type Thread { id: ID! time: Time } type Time { ms: Int zone: String }";
    let new =
        "type Query { thread: Thread } type Thread { id: ID! time: Time } type Time { ms: Int }";
    let reads_time = ProjectionInputs::none().own("Thread", &["time"]);
    assert_eq!(
        classify_reading(old, new, &reads_time).tier,
        types(&["Thread", "Time"], false)
    );
    assert_eq!(classify(old, new).tier, Tier::Compatible);
}

#[test]
fn a_removed_field_naming_a_dropped_type_cannot_be_kept() {
    let change = classify_reading(
        "type Query { thread: Thread } type Thread { id: ID! note: Note } type Note { id: ID! body: String }",
        "type Query { thread: Thread } type Thread { id: ID! }",
        &ProjectionInputs::none().own("Note", &["body"]),
    );
    assert_eq!(change.tier, types(&["Note", "Thread"], false));
    assert!(change.stored.field_meta("Thread", "note").is_none());
}

#[test]
fn a_removed_type_whose_name_comes_back_as_an_enum_is_not_kept() {
    // `Status` was an entity nothing reads; it comes back as an enum that
    // `Thread.status` holds. Keeping the old object beside the enum would not
    // validate, so the old type goes with its records instead of every record.
    let change = classify(
        "type Query { thread: Thread status: Status } type Thread { id: ID! status: Status } type Status { id: ID! label: String }",
        "type Query { thread: Thread } type Thread { id: ID! status: Status } enum Status { OPEN CLOSED }",
    );
    assert_eq!(
        change.tier,
        types(&["ROOT_QUERY", "Status", "Thread"], false)
    );
    assert!(change.stored.type_meta("Status").is_none());
    assert!(change.stored.field_meta("Query", "status").is_none());
}

#[test]
fn a_removed_enum_field_whose_type_name_comes_back_as_an_object_is_not_kept() {
    // `Thread.state` held an enum and is removed; `State` comes back as an
    // object. The kept field would name an object as a leaf, so `Thread`
    // changes instead of every record going.
    let change = classify(
        "type Query { thread: Thread } type Thread { id: ID! state: State } enum State { OPEN CLOSED }",
        "type Query { thread: Thread state: State } type Thread { id: ID! } type State { id: ID! label: String }",
    );
    assert_eq!(change.tier, types(&["Thread"], false));
    assert!(change.stored.field_meta("Thread", "state").is_none());
    assert!(change.stored.type_meta("State").is_some());
}

#[test]
fn renamed_roots_or_an_unreadable_schema_reset() {
    let renamed = classify(
        "schema { query: Q } type Q { a: Int }",
        "schema { query: R } type R { a: Int }",
    );
    assert_eq!(renamed.tier, Tier::Reset(ResetReason::Roots));
    let unreadable = SchemaChange::classify(None, &schema(THREAD), &ProjectionInputs::none());
    assert_eq!(unreadable.tier, Tier::Reset(ResetReason::Unreadable));
    assert_eq!(unreadable.stored.hash(), schema(THREAD).hash());
}

const MUTATION_OLD: &str = "type Query { thread: Thread } type Mutation { rename(id: ID!): Thread archive(id: ID!): Boolean } type Thread { id: ID! subject: String }";
const MUTATION_NEW: &str = "type Query { thread: Thread } type Mutation { rename(id: ID!): Thread } type Thread { id: ID! subject: Int }";

fn request(query: &str) -> MutationRequest {
    MutationRequest {
        query: query.to_owned(),
        operation_name: None,
        variables_json: r#"{"id":"1"}"#.to_owned(),
        identity: None,
    }
}

/// A source as the oldest queue rows stored one: the response alone.
fn source(data: Json) -> OptimisticSource {
    decode_optimistic_source(&data.to_string()).unwrap()
}

#[test]
fn an_overlay_fits_when_it_normalizes_without_a_changed_type() {
    let new = schema(MUTATION_NEW);
    let rename = request("mutation($id: ID!) { rename(id: $id) { id subject } }");
    let renamed = source(serde_json::json!({ "rename": { "id": "1", "subject": "x" } }));
    assert!(overlay_fits(&new, &BTreeSet::new(), &rename, &renamed));
    let changed = BTreeSet::from(["Thread".to_owned()]);
    assert!(!overlay_fits(&new, &changed, &rename, &renamed));

    // The incoming schema removed the selected field.
    let archive = request("mutation($id: ID!) { archive(id: $id) }");
    let archived = source(serde_json::json!({ "archive": true }));
    assert!(overlay_fits(
        &schema(MUTATION_OLD),
        &BTreeSet::new(),
        &archive,
        &archived
    ));
    assert!(!overlay_fits(&new, &BTreeSet::new(), &archive, &archived));

    let mut retired = archived;
    retire_overlay(&mut retired);
    assert!(is_retired(&retired));
    assert!(overlay_fits(&new, &changed, &archive, &retired));
}

#[test]
fn stored_schema_round_trips_and_rejects_what_it_cannot_read() {
    let bundled = crate::meta::bundled_schema();
    let bytes = encode_stored_schema(&bundled);
    let decoded = decode_stored_schema(&bytes).unwrap();
    assert_eq!(decoded.hash(), bundled.hash());
    assert!(matches!(
        decode_stored_schema(&bytes[..bytes.len() / 2]),
        Err(StoredSchemaError::Corrupt)
    ));
    let mut artifact = bundled.artifact().clone();
    artifact.compatibility_epoch += 1;
    let newer = miniz_oxide::deflate::compress_to_vec(&serde_json::to_vec(&artifact).unwrap(), 6);
    assert!(matches!(
        decode_stored_schema(&newer),
        Err(StoredSchemaError::Invalid(_))
    ));
}

/// Writes `unrecorded.schema` from the SDL at `CACHE_UNRECORDED_SCHEMA_SDL`.
#[test]
#[ignore = "regenerates unrecorded.schema"]
fn write_unrecorded_schema() {
    let path = std::env::var_os("CACHE_UNRECORDED_SCHEMA_SDL").expect("SDL path");
    let schema = Schema::from_sdl(&std::fs::read_to_string(path).unwrap()).unwrap();
    std::fs::write(
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/schema_change/unrecorded.schema"
        ),
        encode_stored_schema(&schema),
    )
    .unwrap();
}

#[test]
fn unrecorded_schema_is_the_last_schema_before_caches_stored_one() {
    // It was written at epoch 4. A later epoch starts every cache empty, so
    // no cache it describes survives, and it reads as none.
    if crate::codec::CACHE_SCHEMA_COMPATIBILITY_EPOCH != 4 {
        assert!(unrecorded_schema().is_none());
        return;
    }
    let unrecorded = unrecorded_schema().expect("decodes at this compatibility epoch");
    assert_eq!(
        unrecorded.hash(),
        "c51ecf4aaa8c3cf97112b0fad403ff1e205b44b50f9a98600396b7b2454d1765",
        "unrecorded.schema must stay the schema of the last builds before caches stored one"
    );
}
