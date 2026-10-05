use super::*;

pub(super) const VIEWABLE_FORM_ID: &str = "0199a000-0000-7000-8000-00000000f0f0";

#[tokio::test]
async fn form_activity_reads_the_timeline_of_a_form_the_viewer_can_see() {
    let harness = harness();
    let hidden_form_id = "0199a000-0000-7000-8000-00000000f1f1";
    harness.activity_reader.set_records(vec![
        activity_record(
            2,
            ModelEntityType::Form,
            VIEWABLE_FORM_ID,
            activity::RecordedAction::Known(activity::Action::Edited),
            200,
        ),
        activity_record(
            1,
            ModelEntityType::Form,
            VIEWABLE_FORM_ID,
            activity::RecordedAction::Known(activity::Action::Created),
            100,
        ),
        activity_record(
            3,
            ModelEntityType::Form,
            hidden_form_id,
            activity::RecordedAction::Known(activity::Action::Edited),
            300,
        ),
    ]);

    let visible = harness
        .execute(&format!(
            r#"{{ user {{ formActivity(formId: "{VIEWABLE_FORM_ID}", limit: 5) {{ id entityType entityId actorId action {{ __typename }} }} }} }}"#
        ))
        .await;
    assert!(visible.errors.is_empty(), "{:?}", visible.errors);
    assert_eq!(
        visible.data,
        async_graphql::value!({
            "user": {
                "formActivity": [
                    {
                        "id": Uuid::from_u128(2).to_string(),
                        "entityType": "FORM",
                        "entityId": VIEWABLE_FORM_ID,
                        "actorId": VALID_USER_ID,
                        "action": { "__typename": "GraphqlActivityEdited" },
                    },
                    {
                        "id": Uuid::from_u128(1).to_string(),
                        "entityType": "FORM",
                        "entityId": VIEWABLE_FORM_ID,
                        "actorId": VALID_USER_ID,
                        "action": { "__typename": "GraphqlActivityCreated" },
                    },
                ],
            },
        })
    );

    let hidden = harness
        .execute(&format!(
            r#"{{ user {{ formActivity(formId: "{hidden_form_id}") {{ id }} }} }}"#
        ))
        .await;
    assert_eq!(
        hidden
            .errors
            .iter()
            .map(|error| error.message.as_str())
            .collect::<Vec<_>>(),
        ["form not found"]
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
        [(VIEWABLE_FORM_ID.to_owned(), 5)],
        "a form the viewer cannot see is never read"
    );
}
