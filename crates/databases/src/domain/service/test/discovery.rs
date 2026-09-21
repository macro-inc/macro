use super::*;

#[tokio::test]
async fn discovery_includes_nested_tables_in_tab_order_but_not_private_or_trashed_data() {
    let (world, service, database_id, _) = seeded().await;
    let tickets = service
        .create_table(
            receipt(database_id, OWNER, AccessLevel::Owner),
            CreateTable {
                database_id,
                name: "Tickets".into(),
            },
        )
        .await
        .unwrap();
    let private = service
        .create_database(CreateDatabase {
            name: "Private".into(),
            owner_id: user(STRANGER),
        })
        .await
        .unwrap();
    let trashed = service
        .create_database(CreateDatabase {
            name: "Archived".into(),
            owner_id: user(OWNER),
        })
        .await
        .unwrap();
    service
        .trash_database(receipt(trashed.id, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    {
        let mut state = world.lock().unwrap();
        state.tables.reverse();
    }
    for actor in [OWNER, VIEWER] {
        let listed = service.list_databases(viewer(actor)).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].database.id, database_id);
        assert_eq!(
            listed[0]
                .tables
                .iter()
                .map(|table| table.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Guests", "Tickets"]
        );
        assert_eq!(listed[0].tables[1].id, tickets.id);
        assert!(
            listed[0]
                .tables
                .iter()
                .all(|table| table.database_id == database_id)
        );
    }
    let listed = service.list_databases(viewer(STRANGER)).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].database.id, private.id);
    assert!(!listed[0].tables.iter().any(|table| table.id == tickets.id));
}
