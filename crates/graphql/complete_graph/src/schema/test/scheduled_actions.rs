use std::sync::{Arc, Mutex};

use rootcause::Report;
use scheduled_action::domain::{models::ScheduledAction, ports::ScheduledActionReadService};

use super::*;

#[derive(Default)]
struct RecordingScheduledActionReader {
    calls: Mutex<Vec<MacroUserIdStr<'static>>>,
}

impl ScheduledActionReadService for RecordingScheduledActionReader {
    async fn list_accessible(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ScheduledAction>, Report> {
        self.calls.lock().expect("call lock").push(user_id);
        Ok(Vec::new())
    }
}

#[tokio::test]
async fn user_id_does_not_read_routines_and_the_list_receives_the_viewer() {
    let harness = harness();
    let reader = Arc::new(RecordingScheduledActionReader::default());
    let context = graphql_scheduled_action::ScheduledActionGraphqlContext::new(Arc::clone(&reader));

    let id_only = harness
        .schema
        .execute(
            harness
                .request("{ user { id } }", authenticated_parts())
                .data(context.clone()),
        )
        .await;
    assert!(id_only.errors.is_empty(), "{:?}", id_only.errors);
    assert_eq!(
        id_only.data.into_json().unwrap()["user"]["id"],
        VALID_USER_ID
    );
    assert!(reader.calls.lock().expect("call lock").is_empty());

    let listed = harness
        .schema
        .execute(
            harness
                .request(
                    "{ user { scheduledActions { id } } }",
                    authenticated_parts(),
                )
                .data(context),
        )
        .await;
    assert!(listed.errors.is_empty(), "{:?}", listed.errors);
    assert!(
        listed.data.into_json().unwrap()["user"]["scheduledActions"]
            .as_array()
            .expect("list")
            .is_empty()
    );
    let calls = reader.calls.lock().expect("call lock");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].as_ref(), VALID_USER_ID);
}
