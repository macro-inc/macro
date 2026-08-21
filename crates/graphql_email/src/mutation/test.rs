use std::sync::Mutex;

use async_graphql::{EmptySubscription, Object, Schema, SimpleObject};

use super::*;

struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn health(&self) -> bool {
        true
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CapturedMutation {
    Seen {
        user_id: String,
        thread_id: Uuid,
    },
    Label {
        user_id: String,
        thread_id: Uuid,
        label_id: Uuid,
        value: bool,
    },
}

#[derive(Default)]
struct CapturingEmailMutationService {
    calls: Mutex<Vec<CapturedMutation>>,
}

impl EmailMutationService for CapturingEmailMutationService {
    async fn mark_email_thread_seen(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Result<(), EmailErr> {
        self.calls.lock().unwrap().push(CapturedMutation::Seen {
            user_id: user_id.to_string(),
            thread_id,
        });
        Ok(())
    }

    async fn update_email_thread_label(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
        label_id: Uuid,
        value: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        self.calls.lock().unwrap().push(CapturedMutation::Label {
            user_id: user_id.to_string(),
            thread_id,
            label_id,
            value,
        });
        Ok(UpdateThreadLabelsResult {
            successful_ids: Vec::new(),
            failed_ids: Vec::new(),
        })
    }
}

struct TestEmailThreadOutput;

#[derive(SimpleObject)]
struct TestEmailThread {
    id: ID,
    is_read: bool,
}

impl EmailThreadMutationOutput for TestEmailThreadOutput {
    type Thread = TestEmailThread;

    fn load_email_thread<'ctx>(
        _ctx: &'ctx Context<'_>,
        _user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Pin<Box<dyn Future<Output = async_graphql::Result<Option<Self::Thread>>> + Send + 'ctx>>
    {
        Box::pin(async move {
            Ok(Some(TestEmailThread {
                id: ID(thread_id.to_string()),
                is_read: true,
            }))
        })
    }
}

fn schema(
    service: Arc<CapturingEmailMutationService>,
) -> Schema<
    QueryRoot,
    GraphqlEmailMutation<CapturingEmailMutationService, TestEmailThreadOutput>,
    EmptySubscription,
> {
    Schema::build(
        QueryRoot,
        GraphqlEmailMutation::<CapturingEmailMutationService, TestEmailThreadOutput>::new(),
        EmptySubscription,
    )
    .data(service)
    .data(MacroUserIdStr::try_from_email("viewer@example.com").unwrap())
    .finish()
}

#[tokio::test]
async fn mark_seen_calls_the_email_service_and_returns_the_reloaded_thread() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let thread_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ markEmailThreadSeen(input: {{ threadId: "{thread_id}" }}) {{ id isRead }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["markEmailThreadSeen"],
        serde_json::json!({ "id": thread_id, "isRead": true })
    );
    assert_eq!(
        *service.calls.lock().unwrap(),
        vec![CapturedMutation::Seen {
            user_id: "macro|viewer@example.com".to_string(),
            thread_id,
        }]
    );
}

#[tokio::test]
async fn update_label_calls_the_email_service_and_returns_the_reloaded_thread() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let thread_id = Uuid::new_v4();
    let label_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ updateEmailThreadLabel(input: {{ threadId: "{thread_id}", labelId: "{label_id}", value: false }}) {{ id isRead }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["updateEmailThreadLabel"],
        serde_json::json!({ "id": thread_id, "isRead": true })
    );
    assert_eq!(
        *service.calls.lock().unwrap(),
        vec![CapturedMutation::Label {
            user_id: "macro|viewer@example.com".to_string(),
            thread_id,
            label_id,
            value: false,
        }]
    );
}
