use super::*;

#[test]
fn non_identity_people_joins_do_not_mislabel_keys_as_user_ids() {
    for on in [
        "t.title = p.email",
        "t.title = p.name",
        "t.row_id = p.row_id",
    ] {
        let sql = format!("SELECT p.name FROM macro.tasks t JOIN macro.people p ON {on}");
        let (mut engine, Step::Fetch(first)) = Engine::start(&catalog(), &sql).unwrap() else {
            panic!("expected ordinary rows first");
        };
        let Step::Fetch(people) = engine
            .feed_page(
                first.id,
                Page {
                    rows: vec![Row {
                        id: RowId::from_uuid(Uuid::new_v5(&Uuid::NAMESPACE_OID, SAM.as_bytes())),
                        position: None,
                        cells: HashMap::from([(TITLE, Cell::Text("sam@example.com".into()))]),
                    }],
                    next: None,
                },
            )
            .unwrap()
        else {
            panic!("expected a people read");
        };
        // Without an actual user-ID restriction, bounded adapters must refuse.
        // Email/name text and generated row UUIDs are not user identities.
        assert_eq!(people.query, GqlQuery::People { ids: None }, "{on}");
    }
}
