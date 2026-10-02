use super::*;

#[tokio::test]
async fn discovery_includes_nested_tables_in_tab_order_but_not_private_or_trashed_data() {
    let seeded = seeded().await;
    let (world, service, database_id) = (seeded.world, seeded.service, seeded.database_id);
    let tickets = TableId::new();
    service
        .apply_ops(
            edit(database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Table {
                table: tickets,
                change: TableChange::Create {
                    name: "Tickets".into(),
                },
            }]),
        )
        .await
        .unwrap();
    let private = service
        .create_database(CreateDatabase {
            name: "Private".into(),
            owner_id: user(STRANGER),
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    let trashed = service
        .create_database(CreateDatabase {
            name: "Archived".into(),
            owner_id: user(OWNER),
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    service
        .trash_database(receipt(trashed.id, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    // Storage order is not tab order: positions decide.
    world.lock().unwrap().tables.reverse();
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
        assert_eq!(listed[0].tables[1].id, tickets);
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
    assert_eq!(listed[0].grant, AccessLevel::Owner);
    assert_eq!(listed[0].tables.len(), 1);
    assert_eq!(listed[0].tables[0].name, "Table 1");
}
