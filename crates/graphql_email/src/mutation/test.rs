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
    Draft {
        user_id: String,
        link_id: Option<Uuid>,
        db_id: Option<Uuid>,
        replying_to_id: Option<Uuid>,
        subject: String,
        body_html: Option<String>,
        send_time: Option<String>,
    },
    DeleteDraft {
        user_id: String,
        draft_id: Uuid,
    },
}

#[derive(Default)]
struct CapturingEmailMutationService {
    calls: Mutex<Vec<CapturedMutation>>,
    draft_fails_as_already_sent: std::sync::atomic::AtomicBool,
    delete_reports_missing: std::sync::atomic::AtomicBool,
}

const TEST_THREAD_ID: Uuid = Uuid::from_u128(0x7ead);

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

    async fn save_email_draft(
        &self,
        user_id: MacroUserIdStr<'static>,
        link_id: Option<Uuid>,
        input: CreateDraftInput,
    ) -> Result<SavedUserDraft, EmailErr> {
        if self
            .draft_fails_as_already_sent
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(EmailErr::MessageAlreadySent(
                input.db_id.unwrap_or_default(),
            ));
        }
        self.calls.lock().unwrap().push(CapturedMutation::Draft {
            user_id: user_id.to_string(),
            link_id,
            db_id: input.db_id,
            replying_to_id: input.replying_to_id,
            subject: input.subject.clone(),
            body_html: input.body_html.clone(),
            send_time: input.send_time.map(|time| time.to_rfc3339()),
        });
        Ok(SavedUserDraft {
            draft: email::domain::models::CreatedDraft {
                db_id: input.db_id.unwrap_or_default(),
                provider_id: input.provider_id,
                replying_to_id: input.replying_to_id,
                provider_thread_id: input.provider_thread_id,
                thread_db_id: TEST_THREAD_ID,
                link_id: link_id.unwrap_or_default(),
                subject: input.subject,
                to: input.to,
                cc: input.cc,
                bcc: input.bcc,
                body_text: input.body_text,
                body_html: input.body_html,
                body_macro: input.body_macro,
                headers_json: input.headers_json,
                send_time: input.send_time,
            },
            link: test_sending_link(link_id.unwrap_or_default()),
        })
    }

    async fn delete_email_draft(
        &self,
        user_id: MacroUserIdStr<'static>,
        draft_id: Uuid,
    ) -> Result<DeletedUserDraft, EmailErr> {
        if self
            .draft_fails_as_already_sent
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(EmailErr::MessageAlreadySent(draft_id));
        }
        self.calls
            .lock()
            .unwrap()
            .push(CapturedMutation::DeleteDraft {
                user_id: user_id.to_string(),
                draft_id,
            });
        if self
            .delete_reports_missing
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Ok(DeletedUserDraft {
                deleted: false,
                thread_deleted: false,
            });
        }
        Ok(DeletedUserDraft {
            deleted: true,
            thread_deleted: true,
        })
    }
}

fn test_sending_link(id: Uuid) -> email::domain::models::Link {
    email::domain::models::Link {
        id,
        macro_id: MacroUserIdStr::try_from_email("viewer@example.com").unwrap(),
        fusionauth_user_id: "fa-user".to_string(),
        email_address: macro_user_id::email::EmailStr::try_from("viewer@example.com".to_string())
            .unwrap(),
        provider: email::domain::models::UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        created_at: Utc::now(),
        updated_at: Utc::now(),
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

#[tokio::test]
async fn save_email_draft_calls_the_service_and_returns_the_payload() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let draft_id = Uuid::new_v4();
    let link_id = Uuid::new_v4();
    let replying_to_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ saveEmailDraft(input: {{
                draftId: "{draft_id}",
                linkId: "{link_id}",
                replyingToId: "{replying_to_id}",
                subject: "Re: hello",
                bodyHtml: "PHA-aGk8L3A",
                sendTime: "2026-08-27T12:00:00+00:00"
            }}) {{ draftId draft {{ id isDraft isSent subject from {{ email }} }} thread {{ id isRead }} }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["saveEmailDraft"],
        serde_json::json!({
            "draftId": draft_id,
            "draft": {
                "id": draft_id,
                "isDraft": true,
                "isSent": false,
                "subject": "Re: hello",
                "from": { "email": "viewer@example.com" },
            },
            "thread": { "id": TEST_THREAD_ID, "isRead": true },
        })
    );
    assert_eq!(
        *service.calls.lock().unwrap(),
        vec![CapturedMutation::Draft {
            user_id: "macro|viewer@example.com".to_string(),
            link_id: Some(link_id),
            db_id: Some(draft_id),
            replying_to_id: Some(replying_to_id),
            subject: "Re: hello".to_string(),
            body_html: Some("PHA-aGk8L3A".to_string()),
            send_time: Some("2026-08-27T12:00:00+00:00".to_string()),
        }]
    );
}

#[tokio::test]
async fn save_email_draft_defaults_to_the_primary_inbox() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let draft_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ saveEmailDraft(input: {{ draftId: "{draft_id}", subject: "s" }}) {{ draftId }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    match service.calls.lock().unwrap().as_slice() {
        [CapturedMutation::Draft { link_id, .. }] => assert_eq!(*link_id, None),
        other => panic!("unexpected calls: {other:?}"),
    }
}

#[tokio::test]
async fn save_email_draft_rejects_invalid_send_time() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let draft_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ saveEmailDraft(input: {{ draftId: "{draft_id}", subject: "s", sendTime: "tomorrow" }}) {{ draftId }} }}"#
        ))
        .await;

    assert_eq!(response.errors.len(), 1);
    assert!(response.errors[0].message.contains("sendTime"));
    assert!(format!("{:?}", response.errors[0].extensions).contains("INVALID"));
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn save_email_draft_maps_already_sent_to_a_machine_readable_code() {
    let service = Arc::new(CapturingEmailMutationService::default());
    service
        .draft_fails_as_already_sent
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let draft_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ saveEmailDraft(input: {{ draftId: "{draft_id}", subject: "s" }}) {{ draftId }} }}"#
        ))
        .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(
        response.errors[0].message,
        "email draft has already been sent"
    );
    assert!(format!("{:?}", response.errors[0].extensions).contains("DRAFT_ALREADY_SENT"));
}

#[tokio::test]
async fn save_email_draft_rejects_a_malformed_draft_id() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let response = schema(service.clone())
        .execute(
            r#"mutation { saveEmailDraft(input: { draftId: "not-a-uuid", subject: "s" }) { draftId } }"#,
        )
        .await;

    assert_eq!(response.errors.len(), 1);
    assert!(response.errors[0].message.contains("draftId"));
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delete_email_draft_calls_the_service_and_returns_the_payload() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let draft_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ deleteEmailDraft(input: {{ draftId: "{draft_id}" }}) {{ draftId deleted threadDeleted }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["deleteEmailDraft"],
        serde_json::json!({
            "draftId": draft_id,
            "deleted": true,
            "threadDeleted": true,
        })
    );
    assert_eq!(
        *service.calls.lock().unwrap(),
        vec![CapturedMutation::DeleteDraft {
            user_id: "macro|viewer@example.com".to_string(),
            draft_id,
        }]
    );
}

#[tokio::test]
async fn delete_email_draft_reports_an_absent_id_as_a_no_op() {
    let service = Arc::new(CapturingEmailMutationService::default());
    service
        .delete_reports_missing
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let draft_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ deleteEmailDraft(input: {{ draftId: "{draft_id}" }}) {{ draftId deleted threadDeleted }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["deleteEmailDraft"],
        serde_json::json!({
            "draftId": draft_id,
            "deleted": false,
            "threadDeleted": false,
        })
    );
}

#[tokio::test]
async fn delete_email_draft_maps_already_sent_to_a_machine_readable_code() {
    let service = Arc::new(CapturingEmailMutationService::default());
    service
        .draft_fails_as_already_sent
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let draft_id = Uuid::new_v4();
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ deleteEmailDraft(input: {{ draftId: "{draft_id}" }}) {{ draftId }} }}"#
        ))
        .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(
        response.errors[0].message,
        "email draft has already been sent"
    );
    assert!(format!("{:?}", response.errors[0].extensions).contains("DRAFT_ALREADY_SENT"));
}

#[tokio::test]
async fn delete_email_draft_rejects_a_malformed_draft_id() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let response = schema(service.clone())
        .execute(r#"mutation { deleteEmailDraft(input: { draftId: "not-a-uuid" }) { draftId } }"#)
        .await;

    assert_eq!(response.errors.len(), 1);
    assert!(response.errors[0].message.contains("draftId"));
    assert!(service.calls.lock().unwrap().is_empty());
}
