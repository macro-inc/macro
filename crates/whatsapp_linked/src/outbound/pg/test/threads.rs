//! Generic thread, reaction and read-position behaviour of the external chat
//! tables. WhatsApp has no threads and one reaction per person; the rows
//! another provider writes are set up directly.
use super::*;
use crate::domain::provider::WhatsAppProvider;
use async_trait::async_trait;
use external_chat::domain::{
    ports::{
        AccountRef, ChatProvider, ExternalChatResult, Members, MutationTarget, SendIntent,
        SendingFacts, StoredSend,
    },
    timeline::{ReadAdvance, ThreadSummary, view::People},
};
use std::sync::Mutex;

async fn message_id(pool: &PgPool, chat: Uuid, source: &str) -> Uuid {
    sqlx::query_scalar!(
        "SELECT id FROM external_chat_message WHERE chat_id = $1 AND source_id = $2",
        chat,
        source
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_replies_leave_the_timeline_for_their_thread_page(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    for (event, source, body) in [
        (40, "ROOT", "Root"),
        (41, "REPLY", "In the thread"),
        (42, "AFTER", "Later in the chat"),
    ] {
        session
            .ingest_event(alice, &text(event, CUSTOMER_JID, source, body))
            .await
            .unwrap();
    }
    let root = message_id(&pool, binding.id, "ROOT").await;
    let reply = message_id(&pool, binding.id, "REPLY").await;
    sqlx::query!(
        "UPDATE external_chat_message SET thread_root = $1 WHERE id = $2",
        root,
        reply
    )
    .execute(&pool)
    .await
    .unwrap();
    let view = receipt::<MessageView>(ALICE, binding.id);

    let timeline = linked
        .chats
        .messages(&view, None, None, Some(50))
        .await
        .unwrap();
    assert_eq!(
        timeline
            .messages
            .iter()
            .map(|message| (message.body.as_str(), message.thread.clone()))
            .collect::<Vec<_>>(),
        vec![
            ("Later in the chat", None),
            (
                "Root",
                Some(ThreadSummary {
                    reply_count: 1,
                    last_reply_at: timeline.messages[1].thread.as_ref().unwrap().last_reply_at,
                    unread: true,
                })
            ),
        ]
    );
    let thread = linked
        .chats
        .messages(&view, Some(root), None, Some(50))
        .await
        .unwrap();
    assert_eq!(
        thread
            .messages
            .iter()
            .map(|message| (message.id, message.body.as_str(), message.thread_root))
            .collect::<Vec<_>>(),
        vec![(reply, "In the thread", Some(root))]
    );
    assert_eq!(
        linked.chats.detail(&view).await.unwrap().chat.unread_count,
        2
    );

    linked.chats.mark_read(&view, reply).await.unwrap();
    assert!(
        !linked
            .chats
            .message(&view, root)
            .await
            .unwrap()
            .thread
            .unwrap()
            .unread
    );
    assert_eq!(
        linked.chats.detail(&view).await.unwrap().chat.unread_count,
        2,
        "reading a thread leaves the chat unread"
    );
    assert_eq!(
        linked
            .chats
            .messages(&view, Some(reply), None, Some(50))
            .await
            .unwrap_err()
            .current_context(),
        &ExternalChatError::NotFound,
        "a reply starts no thread"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn whatsapp_keeps_one_reaction_per_person_where_others_may_hold_several(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    session
        .ingest_event(alice, &text(50, CUSTOMER_JID, "REACTED", "React to me"))
        .await
        .unwrap();
    let message = message_id(&pool, binding.id, "REACTED").await;
    let customer = sqlx::query_scalar!(
        "SELECT person_id FROM external_chat_message WHERE id = $1",
        message
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO external_chat_reaction (message_id, person_id, emoji, source_id, revision, updated_at)
        VALUES ($1, $2, '👍', 'R1', 0, now()), ($1, $2, '🎉', 'R2', 0, now())",
        message,
        customer
    )
    .execute(&pool)
    .await
    .unwrap();
    let emoji = || async {
        linked
            .store
            .messages(&binding, ALICE, None, None, 50)
            .await
            .unwrap()
            .messages[0]
            .reactions
            .iter()
            .map(|reaction| reaction.emoji.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(emoji().await, vec!["🎉", "👍"]);

    let reaction = InboundEvent {
        kind: InboundKind::Message(Message {
            source_id: "3EB0HEART".into(),
            sender: Identity {
                jid: CUSTOMER_JID.into(),
                alternate_jid: None,
                display_name: Some("Customer".into()),
            },
            kind: MessageKind::Reaction,
            text: "❤️".into(),
            history: false,
            from_me: false,
            revision: 1,
            target: Some(Target {
                source_id: "REACTED".into(),
                sender_jid: CUSTOMER_JID.into(),
            }),
            media: vec![],
            mentions: vec![],
            forwarded: false,
            view_once: false,
            rich: None,
        }),
        ..text(51, CUSTOMER_JID, "unused", "")
    };
    session.ingest_event(alice, &reaction).await.unwrap();
    assert_eq!(emoji().await, vec!["❤️"]);
}

/// WhatsApp, recording the read positions the service hands its provider.
struct RecordingReads {
    whatsapp: WhatsAppProvider,
    reads: Mutex<Vec<ReadAdvance>>,
}

#[async_trait]
impl ChatProvider for RecordingReads {
    fn capabilities(&self, chat: &ChatRef) -> Capabilities {
        self.whatsapp.capabilities(chat)
    }
    fn validate_mentions(&self, text: &str, mentions: &[String]) -> ExternalChatResult<()> {
        self.whatsapp.validate_mentions(text, mentions)
    }
    async fn account(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Option<AccountRef>> {
        self.whatsapp.account(user).await
    }
    async fn account_owner(&self, account: Uuid) -> ExternalChatResult<Option<String>> {
        self.whatsapp.account_owner(account).await
    }
    async fn sending_facts(
        &self,
        account: &AccountRef,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<SendingFacts>> {
        self.whatsapp.sending_facts(account, chats).await
    }
    async fn communities(
        &self,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<Option<CommunityReference>>> {
        self.whatsapp.communities(chats).await
    }
    async fn pictures(&self, chats: &[ChatRef]) -> ExternalChatResult<Vec<Option<Uuid>>> {
        self.whatsapp.pictures(chats).await
    }
    async fn members(&self, chat: &ChatRef) -> ExternalChatResult<Option<Members>> {
        self.whatsapp.members(chat).await
    }
    async fn people(
        &self,
        chat: &ChatRef,
        ids: &[String],
        persons: &[Uuid],
    ) -> ExternalChatResult<People> {
        self.whatsapp.people(chat, ids, persons).await
    }
    async fn request_refresh(&self, chat: &ChatRef, viewer: &str) -> ExternalChatResult<()> {
        self.whatsapp.request_refresh(chat, viewer).await
    }
    async fn read_advanced(&self, _chat: &ChatRef, read: &ReadAdvance) -> ExternalChatResult<()> {
        self.reads.lock().unwrap().push(read.clone());
        Ok(())
    }
    async fn adopt(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
        request: &AddChat,
    ) -> ExternalChatResult<ChatRef> {
        self.whatsapp.adopt(user, request).await
    }
    async fn detach(&self, chat: &ChatRef) -> ExternalChatResult<()> {
        self.whatsapp.detach(chat).await
    }
    async fn mutation_target(
        &self,
        chat: &ChatRef,
        message: Uuid,
    ) -> ExternalChatResult<Option<MutationTarget>> {
        self.whatsapp.mutation_target(chat, message).await
    }
    async fn stored_send(
        &self,
        chat_id: Uuid,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
        idempotency_key: Uuid,
    ) -> ExternalChatResult<Option<StoredSend>> {
        self.whatsapp
            .stored_send(chat_id, user, idempotency_key)
            .await
    }
    async fn enqueue_send(&self, intent: SendIntent<'_>) -> ExternalChatResult<SendProgress> {
        self.whatsapp.enqueue_send(intent).await
    }
    async fn open_sends(
        &self,
        chat_id: Uuid,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<SendProgress>> {
        self.whatsapp.open_sends(chat_id, user).await
    }
    async fn sends_for(
        &self,
        chat_id: Uuid,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> ExternalChatResult<Vec<SendProgress>> {
        self.whatsapp.sends_for(chat_id, user, ids).await
    }
    async fn delivery_states(
        &self,
        chat_id: Uuid,
        viewer: &str,
        messages: &[Uuid],
    ) -> ExternalChatResult<Vec<(Uuid, DeliveryState)>> {
        self.whatsapp
            .delivery_states(chat_id, viewer, messages)
            .await
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_owners_advancing_reads_reach_the_provider(pool: PgPool) {
    let (linked, session, repository, binding, alice, _) = adopted(&pool).await;
    for (event, source, body) in [
        (60, "FIRST", "First"),
        (61, "THREADED", "In a thread"),
        (62, "SECOND", "Second"),
    ] {
        session
            .ingest_event(alice, &text(event, CUSTOMER_JID, source, body))
            .await
            .unwrap();
    }
    let first = message_id(&pool, binding.id, "FIRST").await;
    let threaded = message_id(&pool, binding.id, "THREADED").await;
    let second = message_id(&pool, binding.id, "SECOND").await;
    sqlx::query!(
        "UPDATE external_chat_message SET thread_root = $1 WHERE id = $2",
        first,
        threaded
    )
    .execute(&pool)
    .await
    .unwrap();
    let provider = Arc::new(RecordingReads {
        whatsapp: WhatsAppProvider::new(repository),
        reads: Mutex::new(vec![]),
    });
    let chats = ExternalChatService::new(
        ChatProviders {
            whatsapp: provider.clone(),
            slack: Arc::new(UnconfiguredProvider),
        },
        linked.store.clone(),
        Arc::new(Allow),
    );
    let alice_view = receipt::<MessageView>(ALICE, binding.id);
    chats.mark_read(&alice_view, second).await.unwrap();
    chats.mark_read(&alice_view, first).await.unwrap();
    chats.mark_read(&alice_view, threaded).await.unwrap();
    chats
        .mark_read(&receipt::<MessageView>(BOB, binding.id), second)
        .await
        .unwrap();

    let reads = provider.reads.lock().unwrap().clone();
    assert_eq!(
        reads
            .iter()
            .map(|read| (read.message_id, read.thread_root))
            .collect::<Vec<_>>(),
        vec![(second, None), (threaded, Some(first))],
        "an older chat read and another viewer's read stay in Macro"
    );
}
