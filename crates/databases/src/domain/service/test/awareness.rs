//! Awareness relays reach the gateway, and a refused relay is an error.

use super::*;

#[tokio::test]
async fn awareness_is_relayed_for_the_viewer() {
    let seeded = seeded().await;
    let state = Awareness {
        peer_id: Some(uuid::Uuid::from_u128(7)),
        table_id: seeded.table_id,
        row_id: Some(seeded.row_id),
        column_id: Some(seeded.name_column.id),
        end_row_id: Some(seeded.row_id),
        end_column_id: Some(seeded.name_column.id),
        editing: true,
        left: false,
    };
    seeded
        .service
        .share_awareness(
            receipt::<ViewAccessLevel>(seeded.database_id, VIEWER, AccessLevel::View),
            viewer(VIEWER),
            state.clone(),
        )
        .await
        .unwrap();
    assert_eq!(
        seeded.world.lock().unwrap().awareness,
        vec![(seeded.database_id, VIEWER.to_string(), state)]
    );
}

#[tokio::test]
async fn a_refused_relay_is_an_error() {
    let seeded = seeded().await;
    seeded.world.lock().unwrap().awareness_relay_fails = true;
    let error = seeded
        .service
        .share_awareness(
            receipt::<ViewAccessLevel>(seeded.database_id, VIEWER, AccessLevel::View),
            viewer(VIEWER),
            Awareness {
                peer_id: Some(uuid::Uuid::from_u128(7)),
                table_id: seeded.table_id,
                row_id: None,
                column_id: None,
                end_row_id: None,
                end_column_id: None,
                editing: false,
                left: true,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, DatabaseError::Repo(_)), "got {error:?}");
}
