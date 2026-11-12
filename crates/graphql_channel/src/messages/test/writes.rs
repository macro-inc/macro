use async_graphql::Variables;
use macro_authorization::{CredentialOrigin, MacroAuthorization, MacroUserAuthentication};
use messages::domain::{
    models::{NewAttachment, PostMessage},
    ports::{AttachmentChange, MessagePatch, Sequenced},
};

use super::*;
use crate::messages::{
    ChannelMessageMutationRoot,
    writes::{ChannelMessageWrites, Reaction, WriteFuture, WrittenMessage},
};

/// A write the resolvers asked for, with the caller it acts for.
#[derive(Debug)]
enum Call {
    Post(Uuid, PostMessage),
    Edit(Uuid, Uuid, MessagePatch),
    Delete(Uuid, Uuid, Option<String>),
    React(Uuid, Uuid, Reaction),
}

#[derive(Default)]
pub(super) struct FakeWrites {
    /// What the next write answers; a written reply with seq 5 when unset.
    answer: Mutex<Option<Result<Sequenced<WrittenMessage>, MessageError>>>,
    calls: Mutex<Vec<(String, Call)>>,
}

impl FakeWrites {
    fn answering(answer: Result<Sequenced<WrittenMessage>, MessageError>) -> Arc<Self> {
        Arc::new(Self {
            answer: Mutex::new(Some(answer)),
            ..Self::default()
        })
    }

    fn record(
        &self,
        caller: MacroAuthorization,
        call: Call,
    ) -> WriteFuture<'_, Sequenced<WrittenMessage>> {
        let caller = caller
            .acting_user()
            .map(|user| user.macro_user_id.as_ref().to_owned())
            .unwrap_or_default();
        self.calls.lock().unwrap().push((caller, call));
        let answer = self.answer.lock().unwrap().take().unwrap_or_else(|| {
            Ok(Sequenced {
                value: WrittenMessage::Bare(Box::new(message(101, Some(1)))),
                seq: Some(5),
            })
        });
        Box::pin(async move { answer })
    }
}

impl ChannelMessageWrites for FakeWrites {
    fn post(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        input: PostMessage,
    ) -> WriteFuture<'_, Sequenced<WrittenMessage>> {
        self.record(caller, Call::Post(channel_id, input))
    }

    fn edit(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        patch: MessagePatch,
    ) -> WriteFuture<'_, Sequenced<WrittenMessage>> {
        self.record(caller, Call::Edit(channel_id, message_id, patch))
    }

    fn delete(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        nonce: Option<String>,
    ) -> WriteFuture<'_, Sequenced<WrittenMessage>> {
        self.record(caller, Call::Delete(channel_id, message_id, nonce))
    }

    fn react(
        &self,
        caller: MacroAuthorization,
        channel_id: Uuid,
        message_id: Uuid,
        reaction: Reaction,
    ) -> WriteFuture<'_, Sequenced<WrittenMessage>> {
        self.record(caller, Call::React(channel_id, message_id, reaction))
    }
}

fn caller() -> MacroAuthorization {
    MacroAuthorization::User(MacroUserAuthentication {
        origin: CredentialOrigin::Session,
        agent_id: None,
        agent_via: None,
        macro_user_id: graphql_common::parse_macro_user_id(USER.to_owned(), "user").unwrap(),
        user_context: Default::default(),
    })
}

async fn write(
    writes: Arc<FakeWrites>,
    caller: Option<MacroAuthorization>,
    mutation: &str,
    input: Value,
) -> async_graphql::Response {
    let user = graphql_common::parse_macro_user_id(USER.to_owned(), "user").unwrap();
    let context = ChannelMessagesGraphqlContext::from_ports(Arc::new(FakeReads::default()), writes)
        .for_organization(Some(7));
    let context = match caller {
        Some(caller) => context.with_caller(caller),
        None => context,
    };
    let (field, input_type) = match mutation {
        "post" => ("postChannelMessage", "GraphqlChannelPostMessageInput"),
        "edit" => ("editChannelMessage", "GraphqlChannelEditMessageInput"),
        "delete" => ("deleteChannelMessage", "GraphqlChannelDeleteMessageInput"),
        _ => ("reactToChannelMessage", "GraphqlChannelReactInput"),
    };
    let query = format!(
        "mutation($input: {input_type}!) {{ {field}(input: $input) {{
            seq
            message {{ id threadId content deletedAt thread {{ replyCount }} call {{ state }} }}
        }} }}"
    );
    Schema::build(
        GraphqlChannelMessagesQuery::new(user),
        ChannelMessageMutationRoot,
        EmptySubscription,
    )
    .finish()
    .execute(
        Request::new(query)
            .variables(Variables::from_json(json!({ "input": input })))
            .data(context),
    )
    .await
}

fn written(response: async_graphql::Response, field: &str) -> Value {
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    response.data.into_json().unwrap()[field].clone()
}

fn error_code(response: &async_graphql::Response) -> (Value, Value) {
    assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
    let error = serde_json::to_value(&response.errors[0]).unwrap();
    (
        error["message"].clone(),
        error["extensions"]["code"].clone(),
    )
}

#[tokio::test]
async fn a_post_reaches_the_writes_as_the_rest_route_takes_it_and_returns_its_seq() {
    let writes = Arc::new(FakeWrites::default());
    let id = Uuid::now_v7();
    let response = write(
        writes.clone(),
        Some(caller()),
        "post",
        json!({
            "channelId": CHANNEL,
            "id": id,
            "content": "hello",
            "threadId": Uuid::from_u128(1),
            "mentions": [{ "entityType": "user", "entityId": USER }],
            "attachments": [{ "entityType": "document", "entityId": "doc", "width": 640 }],
            "nonce": "n-1",
        }),
    )
    .await;
    let post = written(response, "postChannelMessage");
    assert_eq!(post["seq"], 5);
    assert_eq!(post["message"]["id"], json!(Uuid::from_u128(101)));
    assert_eq!(post["message"]["threadId"], json!(Uuid::from_u128(1)));
    assert_eq!(post["message"]["thread"], Value::Null);

    let (who, call) = writes.calls.lock().unwrap().remove(0);
    assert_eq!(who, USER);
    let Call::Post(channel_id, input) = call else {
        panic!("expected a post, got {call:?}");
    };
    assert_eq!(channel_id, CHANNEL);
    assert_eq!(input.id, Some(id));
    assert_eq!(input.content, "hello");
    assert_eq!(input.thread_id, Some(Uuid::from_u128(1)));
    assert!(input.anchor.is_none());
    assert_eq!(
        input.mentions,
        [SimpleMention {
            entity_type: "user".into(),
            entity_id: USER.into(),
        }]
    );
    assert_eq!(
        serde_json::to_value(&input.attachments).unwrap(),
        serde_json::to_value([NewAttachment {
            entity_type: "document".into(),
            entity_id: "doc".into(),
            width: Some(640),
            height: None,
        }])
        .unwrap()
    );
    assert_eq!(input.nonce.as_deref(), Some("n-1"));
}

#[tokio::test]
async fn a_replayed_post_returns_the_stored_root_with_a_null_seq() {
    let writes = FakeWrites::answering(Ok(Sequenced::unlogged(WrittenMessage::Root {
        item: Box::new(root(1)),
        call: None,
    })));
    let response = write(
        writes,
        Some(caller()),
        "post",
        json!({ "channelId": CHANNEL, "id": Uuid::from_u128(1), "content": "hello" }),
    )
    .await;
    let post = written(response, "postChannelMessage");
    assert_eq!(post["seq"], Value::Null);
    // A root comes back as the timeline shows it, with its thread.
    assert_eq!(post["message"]["id"], json!(Uuid::from_u128(1)));
    assert_eq!(post["message"]["thread"], json!({ "replyCount": 7 }));
    assert_eq!(post["message"]["call"], Value::Null);
}

#[tokio::test]
async fn an_edit_spells_each_attachment_change_the_rest_patch_takes() {
    let writes = Arc::new(FakeWrites::default());
    let message_id = Uuid::from_u128(101);
    for attachments in [
        Value::Null,
        json!({ "replace": [{ "entityType": "document", "entityId": "doc" }] }),
        json!({ "delta": { "remove": [Uuid::from_u128(1001)], "add": [] } }),
    ] {
        let response = write(
            writes.clone(),
            Some(caller()),
            "edit",
            json!({
                "channelId": CHANNEL,
                "messageId": message_id,
                "content": "edited",
                "attachments": attachments,
            }),
        )
        .await;
        assert_eq!(written(response, "editChannelMessage")["seq"], 5);
    }

    let calls = writes.calls.lock().unwrap();
    let patches: Vec<&MessagePatch> = calls
        .iter()
        .map(|(_, call)| match call {
            Call::Edit(channel_id, id, patch) => {
                assert_eq!((*channel_id, *id), (CHANNEL, message_id));
                patch
            }
            call => panic!("expected an edit, got {call:?}"),
        })
        .collect();
    assert_eq!(patches[0].content.as_deref(), Some("edited"));
    assert!(patches[0].mentions.is_none());
    assert!(matches!(patches[0].attachments, AttachmentChange::Preserve));
    assert!(
        matches!(&patches[1].attachments, AttachmentChange::Replace(added) if added.len() == 1)
    );
    assert!(matches!(
        &patches[2].attachments,
        AttachmentChange::Delta { remove, add } if remove == &[Uuid::from_u128(1001)] && add.is_empty()
    ));
}

#[tokio::test]
async fn a_delete_and_a_reaction_reach_the_writes_with_their_message() {
    let mut tombstone = message(101, Some(1));
    tombstone.deleted_at = Some(at(9));
    tombstone.content.clear();
    let writes = FakeWrites::answering(Ok(Sequenced::unlogged(WrittenMessage::Bare(Box::new(
        tombstone,
    )))));
    let message_id = Uuid::from_u128(101);
    let response = write(
        writes.clone(),
        Some(caller()),
        "delete",
        json!({ "channelId": CHANNEL, "messageId": message_id, "nonce": "n-2" }),
    )
    .await;
    let deleted = written(response, "deleteChannelMessage");
    assert_eq!(deleted["seq"], Value::Null);
    assert_eq!(deleted["message"]["content"], "");
    assert!(deleted["message"]["deletedAt"].is_string());

    let response = write(
        writes.clone(),
        Some(caller()),
        "react",
        json!({ "channelId": CHANNEL, "messageId": message_id, "emoji": "+1", "add": false }),
    )
    .await;
    assert_eq!(written(response, "reactToChannelMessage")["seq"], 5);

    let calls = writes.calls.lock().unwrap();
    assert!(matches!(
        &calls[0].1,
        Call::Delete(channel_id, id, Some(nonce))
            if (*channel_id, *id, nonce.as_str()) == (CHANNEL, message_id, "n-2")
    ));
    assert!(matches!(
        &calls[1].1,
        Call::React(channel_id, id, Reaction { emoji, add: false, nonce: None })
            if (*channel_id, *id, emoji.as_str()) == (CHANNEL, message_id, "+1")
    ));
}

#[tokio::test]
async fn a_written_call_root_carries_its_call() {
    let mut call = root(3);
    call.message.kind = MessageKind::CallRoot;
    let writes = FakeWrites::answering(Ok(Sequenced {
        value: WrittenMessage::Root {
            item: Box::new(call),
            call: Some(CallEntryStatus::Live),
        },
        seq: Some(9),
    }));
    let response = write(
        writes,
        Some(caller()),
        "react",
        json!({ "channelId": CHANNEL, "messageId": Uuid::from_u128(3), "emoji": "+1", "add": true }),
    )
    .await;
    let reacted = written(response, "reactToChannelMessage");
    assert_eq!(reacted["seq"], 9);
    assert_eq!(reacted["message"]["call"], json!({ "state": "LIVE" }));
}

#[tokio::test]
async fn a_refused_write_reports_its_kind_and_only_busy_invites_a_retry() {
    for (error, code, message) in [
        (MessageError::Busy, "BUSY", "too many writes at once; retry"),
        (MessageError::Forbidden, "FORBIDDEN", "forbidden"),
        (
            MessageError::NotFound,
            "NOT_FOUND",
            "channel or message not found",
        ),
        (
            MessageError::Conflict,
            "CONFLICT",
            "message id already exists",
        ),
        (
            MessageError::Invalid("a message needs content or an attachment"),
            "BAD_USER_INPUT",
            "a message needs content or an attachment",
        ),
        (
            MessageError::Repository(rootcause::report!("database host db-7 refused")),
            "INTERNAL_SERVER_ERROR",
            "channel messages are unavailable",
        ),
    ] {
        let writes = FakeWrites::answering(Err(error));
        let response = write(
            writes,
            Some(caller()),
            "post",
            json!({ "channelId": CHANNEL, "content": "hello" }),
        )
        .await;
        assert_eq!(error_code(&response), (json!(message), json!(code)));
    }
}

#[tokio::test]
async fn a_write_without_a_caller_or_with_a_malformed_id_never_reaches_the_writes() {
    let writes = Arc::new(FakeWrites::default());
    let response = write(
        writes.clone(),
        None,
        "delete",
        json!({ "channelId": CHANNEL, "messageId": Uuid::from_u128(101) }),
    )
    .await;
    assert_eq!(
        error_code(&response),
        (json!("authentication required"), json!("FORBIDDEN"))
    );

    for (mutation, input) in [
        (
            "post",
            json!({ "channelId": "not an id", "content": "hello" }),
        ),
        (
            "post",
            json!({ "channelId": CHANNEL, "id": "not an id", "content": "hello" }),
        ),
        (
            "edit",
            json!({
                "channelId": CHANNEL,
                "messageId": Uuid::from_u128(101),
                "attachments": { "delta": { "remove": ["not an id"], "add": [] } },
            }),
        ),
        (
            "react",
            json!({ "channelId": CHANNEL, "messageId": "not an id", "emoji": "+1", "add": true }),
        ),
    ] {
        let response = write(writes.clone(), Some(caller()), mutation, input).await;
        assert_eq!(
            error_code(&response).1,
            json!("BAD_USER_INPUT"),
            "{mutation}"
        );
    }
    assert!(writes.calls.lock().unwrap().is_empty());
}
