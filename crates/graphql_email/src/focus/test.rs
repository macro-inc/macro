use std::sync::Mutex;

use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
use chrono::{TimeZone, Utc};

use super::*;

struct FakeReader {
    stored: HashMap<Uuid, ThreadFocus>,
    ordered: Vec<Uuid>,
    calls: Mutex<Vec<(String, Vec<Uuid>)>>,
    /// Fail every classification lookup, as when the database is down.
    failing: bool,
}

impl EmailFocusReader for FakeReader {
    fn focus_thread_ids<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        window_days: u16,
    ) -> BoxFuture<'a, Result<Vec<Uuid>, rootcause::Report>> {
        self.calls
            .lock()
            .unwrap()
            .push((format!("{user}:{window_days}"), Vec::new()));
        Box::pin(async { Ok(self.ordered.clone()) })
    }

    fn focus_for_threads<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> BoxFuture<'a, Result<HashMap<Uuid, ThreadFocus>, rootcause::Report>> {
        self.calls
            .lock()
            .unwrap()
            .push((user.to_string(), thread_ids.clone()));
        Box::pin(async move {
            if self.failing {
                return Err(rootcause::report!("database unavailable"));
            }
            Ok(thread_ids
                .into_iter()
                .filter_map(|id| self.stored.get(&id).map(|focus| (id, focus.clone())))
                .collect())
        })
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("viewer@acme.com").unwrap()
}

fn focus(importance: u8) -> ThreadFocus {
    ThreadFocus {
        is_focus: true,
        category: FocusCategory::ColdPitch,
        importance,
        needs_reply: true,
        needs_follow_up: false,
        classified_at: Utc.with_ymd_and_hms(2026, 10, 9, 12, 0, 0).unwrap(),
    }
}

struct Query {
    threads: Vec<Uuid>,
}

#[Object]
impl Query {
    async fn focus(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Option<GraphqlEmailThreadFocus>>> {
        // Fields resolve concurrently in a real query; load the same way so they batch.
        futures::future::try_join_all(
            self.threads
                .iter()
                .map(|thread_id| load_email_thread_focus(ctx, *thread_id)),
        )
        .await
    }

    async fn ids(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<String>> {
        Ok(load_email_focus_thread_ids(ctx, &user(), 30)
            .await?
            .into_iter()
            .map(|id| id.to_string())
            .collect())
    }
}

#[tokio::test]
async fn focus_edge_maps_stored_classifications() {
    let (known, unknown) = (Uuid::new_v4(), Uuid::new_v4());
    let reader = Arc::new(FakeReader {
        stored: HashMap::from([(known, focus(87))]),
        ordered: vec![known],
        calls: Mutex::default(),
        failing: false,
    });
    let schema = Schema::build(
        Query {
            threads: vec![known, unknown],
        },
        EmptyMutation,
        EmptySubscription,
    )
    .data(email_thread_focus_loader(user(), reader.clone()))
    .data(EmailFocusContext(reader.clone()))
    .finish();

    let response = schema
        .execute(
            "{ focus { isFocus category importance needsReply needsFollowUp classifiedAt } ids }",
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["focus"][0]["category"], "COLD_PITCH");
    assert_eq!(data["focus"][0]["importance"], 87);
    assert_eq!(data["focus"][0]["needsReply"], true);
    assert_eq!(
        data["focus"][0]["classifiedAt"],
        "2026-10-09T12:00:00+00:00"
    );
    assert!(data["focus"][1].is_null());
    assert_eq!(data["ids"][0], known.to_string());
    // Both edge lookups were batched into one read for the viewer.
    let calls = reader.calls.lock().unwrap();
    assert!(
        calls
            .iter()
            .any(|(who, ids)| who == "macro|viewer@acme.com" && ids.len() == 2)
    );
    // The list is read for the viewer over the requested window.
    assert!(
        calls
            .iter()
            .any(|(who, _)| who == "macro|viewer@acme.com:30")
    );
}

#[tokio::test]
async fn a_failed_lookup_errors_only_the_focus_field() {
    let thread = Uuid::new_v4();
    let reader = Arc::new(FakeReader {
        stored: HashMap::new(),
        ordered: vec![thread],
        calls: Mutex::default(),
        failing: true,
    });
    let schema = Schema::build(
        Query {
            threads: vec![thread],
        },
        EmptyMutation,
        EmptySubscription,
    )
    .data(email_thread_focus_loader(user(), reader.clone()))
    .data(EmailFocusContext(reader))
    .finish();

    let response = schema.execute("{ focus { importance } ids }").await;
    assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
    assert_eq!(
        response.errors[0].message,
        "email thread focus is unavailable"
    );
    let data = response.data.into_json().unwrap();
    assert!(data["focus"].is_null());
    assert_eq!(data["ids"][0], thread.to_string());
}

#[tokio::test]
async fn focus_is_absent_where_it_is_not_served() {
    let schema = Schema::build(
        Query {
            threads: vec![Uuid::new_v4()],
        },
        EmptyMutation,
        EmptySubscription,
    )
    .finish();
    let response = schema.execute("{ focus { importance } ids }").await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert!(data["focus"][0].is_null());
    assert_eq!(data["ids"], serde_json::json!([]));
}
