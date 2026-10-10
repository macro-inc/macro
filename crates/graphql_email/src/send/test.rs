use super::*;
use async_graphql::{EmptySubscription, Schema, SimpleObject};
use email::domain::models::EmailErr;
use std::{pin::Pin, sync::Mutex};
use uuid::Uuid;

#[derive(Default)]
struct Service {
    calls: Mutex<Vec<(String, Uuid, SendAttemptId, Option<SendSnapshot>)>>,
    fail_hydration: bool,
}
fn attempt(id: SendAttemptId, status: SendAttemptStatus) -> SendAttempt {
    SendAttempt {
        transitioned: false,
        message: None,
        attempt_id: id,
        status,
        message_id: None,
        thread_id: Some(Uuid::nil()),
        send_time: Some(chrono::Utc::now()),
    }
}
impl EmailSendService for Service {
    async fn send_email(
        &self,
        actor: MacroUserIdStr<'static>,
        link: Uuid,
        id: SendAttemptId,
        snapshot: SendSnapshot,
    ) -> Result<SendAttempt, EmailErr> {
        self.calls
            .lock()
            .unwrap()
            .push((actor.to_string(), link, id, Some(snapshot)));
        Ok(attempt(id, SendAttemptStatus::Accepted))
    }
    async fn cancel_email_send(
        &self,
        actor: MacroUserIdStr<'static>,
        link: Uuid,
        id: SendAttemptId,
    ) -> Result<SendAttempt, EmailErr> {
        self.calls
            .lock()
            .unwrap()
            .push((actor.to_string(), link, id, None));
        Ok(attempt(id, SendAttemptStatus::Cancelled))
    }
    async fn email_send_status(
        &self,
        actor: MacroUserIdStr<'static>,
        link: Uuid,
        id: SendAttemptId,
    ) -> Result<Option<SendAttempt>, EmailErr> {
        self.calls
            .lock()
            .unwrap()
            .push((actor.to_string(), link, id, None));
        Ok(Some(attempt(id, SendAttemptStatus::Sending)))
    }
}
struct Query;
#[Object]
impl Query {
    async fn status(
        &self,
        ctx: &Context<'_>,
        input: EmailSendAttemptInput,
    ) -> async_graphql::Result<Option<EmailSendAttemptPayload>> {
        load_send_attempt(
            ctx.data::<Arc<Service>>()?.as_ref(),
            require_authenticated_user(ctx)?,
            input,
        )
        .await
    }
}
struct ThreadOutput;
#[derive(SimpleObject)]
struct Thread {
    id: ID,
}
impl EmailThreadMutationOutput for ThreadOutput {
    type Thread = Thread;
    fn load_email_thread<'ctx>(
        ctx: &'ctx Context<'_>,
        _: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Pin<Box<dyn Future<Output = async_graphql::Result<Option<Thread>>> + Send + 'ctx>> {
        Box::pin(async move {
            if ctx.data::<Arc<Service>>()?.fail_hydration {
                return Err(async_graphql::Error::new("response hydration unavailable"));
            }
            Ok(Some(Thread {
                id: ID(id.to_string()),
            }))
        })
    }
}
fn schema(
    service: Arc<Service>,
    authenticated: bool,
) -> Schema<Query, GraphqlEmailSendMutation<Service, ThreadOutput>, EmptySubscription> {
    let builder = Schema::build(
        Query,
        GraphqlEmailSendMutation::default(),
        EmptySubscription,
    )
    .data(service);
    if authenticated {
        builder
            .data(MacroUserIdStr::try_from_email("viewer@example.com").unwrap())
            .finish()
    } else {
        builder.finish()
    }
}
const SEND: &str = r#"mutation { sendEmailMessage(input: {
    attempt: {attemptId:"00000000-0000-4000-8000-000000000001",linkId:"00000000-0000-4000-8000-000000000002"},
    message: {draftId:"00000000-0000-4000-8000-000000000003",subject:"Approved",to:[{email:"to@example.com"}],bodyHtml:"aHRtbA"},
    includeSignature:false,attachmentIds:["00000000-0000-4000-8000-000000000004"],forwardedAttachmentIds:[],restoreBodyText:"Editable"
}) { attempt {attemptId status sendTime threadId message {id}} thread {id} } }"#;

#[tokio::test]
async fn authenticated_send_maps_the_immutable_snapshot_and_selected_inbox() {
    let service = Arc::new(Service::default());
    let response = schema(service.clone(), true).execute(SEND).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["sendEmailMessage"]["attempt"]["status"],
        "ACCEPTED"
    );
    let calls = service.calls.lock().unwrap();
    assert_eq!(calls[0].0, "macro|viewer@example.com");
    assert_eq!(
        calls[0].1.to_string(),
        "00000000-0000-4000-8000-000000000002"
    );
    let snapshot = calls[0].3.as_ref().unwrap();
    assert_eq!(snapshot.message.subject, "Approved");
    assert_eq!(snapshot.message.include_signature, Some(false));
    assert_eq!(snapshot.message.body_html.as_deref(), Some("aHRtbA"));
    assert_eq!(snapshot.restore_body_text.as_deref(), Some("Editable"));
    assert_eq!(snapshot.attachment_ids.len(), 1);
}

#[tokio::test]
async fn unauthenticated_send_never_calls_the_domain() {
    let service = Arc::new(Service::default());
    assert!(
        !schema(service.clone(), false)
            .execute(SEND)
            .await
            .errors
            .is_empty()
    );
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn hydration_failure_after_admission_remains_retryable() {
    let service = Arc::new(Service {
        fail_hydration: true,
        ..Default::default()
    });
    let response = schema(service.clone(), true).execute(SEND).await;
    assert_eq!(service.calls.lock().unwrap().len(), 1);
    assert_eq!(
        response.errors[0]
            .extensions
            .as_ref()
            .unwrap()
            .get("retryable"),
        Some(&async_graphql::Value::Boolean(true))
    );
}

#[tokio::test]
async fn cancel_and_status_use_the_same_scoped_attempt() {
    let service = Arc::new(Service::default());
    let schema = schema(service.clone(), true);
    let input = r#"{attemptId:"00000000-0000-4000-8000-000000000001",linkId:"00000000-0000-4000-8000-000000000002"}"#;
    let status = schema
        .execute(format!("{{status(input:{input}){{status}}}}"))
        .await;
    assert!(status.errors.is_empty());
    assert_eq!(
        status.data.into_json().unwrap()["status"]["status"],
        "SENDING"
    );
    let cancel = schema
        .execute(format!(
            "mutation{{cancelEmailSend(input:{input}){{attempt{{status}}}}}}"
        ))
        .await;
    assert!(cancel.errors.is_empty());
    assert_eq!(
        cancel.data.into_json().unwrap()["cancelEmailSend"]["attempt"]["status"],
        "CANCELLED"
    );
    let calls = service.calls.lock().unwrap();
    assert_eq!(calls[0].0, calls[1].0);
    assert_eq!(calls[0].1, calls[1].1);
    assert_eq!(calls[0].2, calls[1].2);
}
