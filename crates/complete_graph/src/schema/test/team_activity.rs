use super::*;

const TEAMMATE_ID: &str = "macro|teammate@example.com";

/// A teammate's edit, as ingestion records it.
fn teammates_edit(id: u128) -> activity::ActivityRecord {
    activity::ActivityRecord {
        id: Uuid::from_u128(id),
        actor: activity::Actor::new_from_user(MacroUserIdStr::parse_from_str(TEAMMATE_ID).unwrap()),
        subject_id: TEAMMATE_ID.to_owned(),
        entity_type: ModelEntityType::Document,
        entity_id: Uuid::from_u128(id + 100).to_string(),
        action: activity::RecordedAction::Known(activity::Action::Edited),
        occurred_at: chrono::DateTime::from_timestamp(i64::try_from(id).unwrap() * 100, 0)
            .expect("valid timestamp"),
    }
}

async fn team_page(harness: &TestHarness, cursor: Option<&str>) -> serde_json::Value {
    let cursor = cursor.map_or(String::new(), |cursor| format!(r#", cursor: "{cursor}""#));
    let response = harness
        .execute(&format!(
            r#"{{ user {{ activity(input: {{scope: TEAM, limit: 2{cursor}}}) {{ items {{ id actorId }} nextCursor }} }} }}"#
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    response.data.into_json().unwrap()["user"]["activity"].clone()
}

#[tokio::test]
async fn team_activity_pages_the_teammate_feed_of_the_authenticated_user() {
    let harness = harness();
    harness.activity_reader.set_records(vec![
        teammates_edit(4),
        // The viewer's own row belongs to the MINE scope.
        activity_record(
            3,
            ModelEntityType::Document,
            &Uuid::from_u128(103).to_string(),
            activity::RecordedAction::Known(activity::Action::Edited),
            300,
        ),
        teammates_edit(2),
        teammates_edit(1),
    ]);

    let first = team_page(&harness, None).await;
    assert_eq!(
        first["items"],
        serde_json::json!([
            { "id": Uuid::from_u128(4).to_string(), "actorId": TEAMMATE_ID },
            { "id": Uuid::from_u128(2).to_string(), "actorId": TEAMMATE_ID },
        ])
    );
    let cursor = first["nextCursor"].as_str().expect("more rows exist");

    let last = team_page(&harness, Some(cursor)).await;
    assert_eq!(
        last["items"],
        serde_json::json!([{ "id": Uuid::from_u128(1).to_string(), "actorId": TEAMMATE_ID }])
    );
    assert!(last["nextCursor"].is_null());
}
