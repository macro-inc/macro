use super::*;

/// A form the viewer edits: they read its timeline.
pub(super) const EDITABLE_FORM_ID: &str = "0199a000-0000-7000-8000-00000000f0f0";
/// A form the viewer only responds to (View): its timeline would name the
/// other respondents, so it is not theirs to read.
pub(super) const RESPONDED_FORM_ID: &str = "0199a000-0000-7000-8000-00000000f2f2";
const OTHER_RESPONDENT_ID: &str = "macro|other-respondent@macro.com";

/// Another respondent's response, as ingestion records it.
fn someone_elses_response(id: u128, form_id: &str) -> activity::ActivityRecord {
    activity::ActivityRecord {
        id: Uuid::from_u128(id),
        actor: activity::Actor::new_from_user(
            MacroUserIdStr::parse_from_str(OTHER_RESPONDENT_ID).unwrap(),
        ),
        subject_id: OTHER_RESPONDENT_ID.to_owned(),
        entity_type: ModelEntityType::Form,
        entity_id: form_id.to_owned(),
        action: activity::RecordedAction::Known(activity::Action::Responded),
        occurred_at: chrono::DateTime::from_timestamp(250, 0).expect("valid timestamp"),
    }
}

#[tokio::test]
async fn an_editor_reads_the_forms_timeline_responses_included() {
    let harness = harness();
    let hidden_form_id = "0199a000-0000-7000-8000-00000000f1f1";
    harness.activity_reader.set_records(vec![
        someone_elses_response(3, EDITABLE_FORM_ID),
        activity_record(
            2,
            ModelEntityType::Form,
            EDITABLE_FORM_ID,
            activity::RecordedAction::Known(activity::Action::Edited),
            200,
        ),
        activity_record(
            1,
            ModelEntityType::Form,
            EDITABLE_FORM_ID,
            activity::RecordedAction::Known(activity::Action::Created),
            100,
        ),
        activity_record(
            4,
            ModelEntityType::Form,
            hidden_form_id,
            activity::RecordedAction::Known(activity::Action::Edited),
            300,
        ),
    ]);

    let visible = harness
        .execute(&format!(
            r#"{{ user {{ formActivity(formId: "{EDITABLE_FORM_ID}", limit: 5) {{ id entityType entityId actorId occurredAt action {{ __typename }} }} }} }}"#
        ))
        .await;
    assert!(visible.errors.is_empty(), "{:?}", visible.errors);
    assert_eq!(
        visible.data,
        async_graphql::value!({
            "user": {
                "formActivity": [
                    {
                        "id": Uuid::from_u128(3).to_string(),
                        "entityType": "FORM",
                        "entityId": EDITABLE_FORM_ID,
                        "actorId": OTHER_RESPONDENT_ID,
                        "occurredAt": "1970-01-01T00:04:10+00:00",
                        "action": { "__typename": "GraphqlActivityResponded" },
                    },
                    {
                        "id": Uuid::from_u128(2).to_string(),
                        "entityType": "FORM",
                        "entityId": EDITABLE_FORM_ID,
                        "actorId": VALID_USER_ID,
                        "occurredAt": "1970-01-01T00:03:20+00:00",
                        "action": { "__typename": "GraphqlActivityEdited" },
                    },
                    {
                        "id": Uuid::from_u128(1).to_string(),
                        "entityType": "FORM",
                        "entityId": EDITABLE_FORM_ID,
                        "actorId": VALID_USER_ID,
                        "occurredAt": "1970-01-01T00:01:40+00:00",
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
        [(EDITABLE_FORM_ID.to_owned(), 5)],
        "a form the viewer cannot see is never read"
    );
}

#[tokio::test]
async fn a_respondent_cannot_read_the_timeline_that_names_other_respondents() {
    let harness = harness();
    harness
        .activity_reader
        .set_records(vec![someone_elses_response(3, RESPONDED_FORM_ID)]);

    let refused = harness
        .execute(&format!(
            r#"{{ user {{ formActivity(formId: "{RESPONDED_FORM_ID}", limit: 5) {{ id actorId occurredAt action {{ __typename }} }} }} }}"#
        ))
        .await;

    // Refused as an unknown form would be: no actor, no time, no count.
    assert_eq!(
        refused
            .errors
            .iter()
            .map(|error| error.message.as_str())
            .collect::<Vec<_>>(),
        ["form not found"]
    );
    assert_eq!(refused.data, async_graphql::value!({ "user": null }));
    assert!(
        harness
            .activity_reader
            .edge_calls
            .lock()
            .expect("activity edge calls lock")
            .is_empty(),
        "a respondent's request never reaches the activity reader"
    );
}
