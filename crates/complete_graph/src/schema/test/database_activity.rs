use super::*;

pub(super) const VIEWABLE_DATABASE_ID: &str = "0199a000-0000-7000-8000-00000000d0d0";

#[tokio::test]
async fn database_activity_reads_the_timeline_of_a_database_the_viewer_can_see() {
    let harness = harness();
    let hidden_database_id = "0199a000-0000-7000-8000-00000000d1d1";
    harness.activity_reader.set_records(vec![
        activity_record(
            2,
            ModelEntityType::Database,
            VIEWABLE_DATABASE_ID,
            activity::RecordedAction::Known(activity::Action::Edited),
            200,
        ),
        activity_record(
            1,
            ModelEntityType::Database,
            VIEWABLE_DATABASE_ID,
            activity::RecordedAction::Known(activity::Action::Created),
            100,
        ),
        activity_record(
            3,
            ModelEntityType::Database,
            hidden_database_id,
            activity::RecordedAction::Known(activity::Action::Edited),
            300,
        ),
    ]);

    let visible = harness
        .execute(&format!(
            r#"{{ user {{ databaseActivity(databaseId: "{VIEWABLE_DATABASE_ID}", limit: 5) {{ id entityType entityId actorId action {{ __typename }} }} }} }}"#
        ))
        .await;
    assert!(visible.errors.is_empty(), "{:?}", visible.errors);
    assert_eq!(
        visible.data,
        async_graphql::value!({
            "user": {
                "databaseActivity": [
                    {
                        "id": Uuid::from_u128(2).to_string(),
                        "entityType": "DATABASE",
                        "entityId": VIEWABLE_DATABASE_ID,
                        "actorId": VALID_USER_ID,
                        "action": { "__typename": "GraphqlActivityEdited" },
                    },
                    {
                        "id": Uuid::from_u128(1).to_string(),
                        "entityType": "DATABASE",
                        "entityId": VIEWABLE_DATABASE_ID,
                        "actorId": VALID_USER_ID,
                        "action": { "__typename": "GraphqlActivityCreated" },
                    },
                ],
            },
        })
    );

    let hidden = harness
        .execute(&format!(
            r#"{{ user {{ databaseActivity(databaseId: "{hidden_database_id}") {{ id }} }} }}"#
        ))
        .await;
    assert_eq!(
        hidden
            .errors
            .iter()
            .map(|error| error.message.as_str())
            .collect::<Vec<_>>(),
        ["database not found"]
    );
    assert_eq!(
        harness
            .activity_reader
            .edge_calls
            .lock()
            .expect("activity edge calls lock")
            .iter()
            .flatten()
            .map(|key| (key.entity.entity_id.to_string(), key.limit))
            .collect::<Vec<_>>(),
        [(VIEWABLE_DATABASE_ID.to_owned(), 5)],
        "a database the viewer cannot see is never read"
    );
}
