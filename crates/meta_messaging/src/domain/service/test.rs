use super::*;
use crate::domain::{
    connection::ConnectionStatus,
    models::{DeliveryState, ProviderId},
    policy::ReplyMode,
    ports::*,
    replies::{ModeEligibility, ReplyBlockReason},
};
use async_trait::async_trait;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use std::sync::Mutex;

#[derive(Clone, Copy)]
enum DuringPreparation {
    None,
    RevokeAccess,
    Disconnect,
    Reconnect,
    MoveTeam,
    ChangeRecipient,
    ClosePolicy,
    RejectContent,
    ExpireLease,
}
struct Memory {
    account: AccountScope,
    conversation: Conversation,
    access: bool,
    policy_allowed: bool,
    content_allowed: bool,
    change: DuringPreparation,
    work: Option<SendWork>,
    digest: Vec<u8>,
    state: DeliveryState,
    provider_id: Option<ProviderId>,
    preparations: usize,
    dispatches: usize,
    fences: usize,
    materializations: usize,
    fail_native: bool,
    unknown: bool,
    fail_settle: Option<DeliveryState>,
    unavailable_checks: usize,
}
struct Fixture(Mutex<Memory>);
struct Transport(Arc<Fixture>);
struct Prepared(Arc<Fixture>, String);

fn fixture() -> (MessagingService, Arc<Fixture>) {
    let account = AccountScope {
        id: Uuid::now_v7(),
        team_id: Uuid::now_v7(),
        generation: Some(Utc::now()),
        status: ConnectionStatus::Connected,
    };
    let conversation = Conversation {
        channel_id: Uuid::now_v7(),
        connection_id: account.id,
        customer_id: "peer-in-a-chat".to_owned().try_into().unwrap(),
        customer_display_name: None,
        customer_phone: None,
        customer_handle: None,
        last_customer_message_at: None,
        standard_window_until: None,
    };
    let fixture = Arc::new(Fixture(Mutex::new(Memory {
        account,
        conversation,
        access: true,
        policy_allowed: true,
        content_allowed: true,
        change: DuringPreparation::None,
        work: None,
        digest: vec![],
        state: DeliveryState::Pending,
        provider_id: None,
        preparations: 0,
        dispatches: 0,
        fences: 0,
        materializations: 0,
        fail_native: false,
        unknown: false,
        fail_settle: None,
        unavailable_checks: 0,
    })));
    let service = MessagingService::new(
        fixture.clone(),
        fixture.clone(),
        Arc::new(Transport(fixture.clone())),
        fixture.clone(),
    );
    (service, fixture)
}
fn receipt(fixture: &Fixture) -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new_authenticated_user(
        "macro|sender@messaging.test".to_owned().try_into().unwrap(),
        Entity {
            entity_id: fixture
                .0
                .lock()
                .unwrap()
                .conversation
                .channel_id
                .to_string(),
            entity_type: EntityType::Channel,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap()
}
fn request() -> SendReply {
    SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "A deliberate text reply".into(),
        },
        reply_to: None,
        human_support: false,
    }
}
fn progress(memory: &Memory) -> SendProgress {
    let work = memory.work.as_ref().unwrap();
    SendProgress {
        id: work.lease.id,
        channel_id: work.channel_id,
        user_id: work.user_id.clone(),
        payload: work.request.clone(),
        created_at: work.created_at,
        state: memory.state,
        message_id: None,
        error_code: None,
    }
}
#[async_trait]
impl ConversationRepository for Fixture {
    async fn account_scope(&self, id: Uuid) -> PortResult<Option<AccountScope>> {
        let memory = self.0.lock().unwrap();
        Ok((id == memory.account.id).then(|| memory.account.clone()))
    }
    async fn conversation(&self, channel: Uuid) -> PortResult<Option<Conversation>> {
        let memory = self.0.lock().unwrap();
        Ok((channel == memory.conversation.channel_id).then(|| memory.conversation.clone()))
    }
    async fn has_message(&self, _: &Conversation, _: &ProviderId) -> PortResult<bool> {
        Ok(false)
    }
    async fn enqueue_send(
        &self,
        connection: Uuid,
        channel: Uuid,
        user: &str,
        request: &SendReply,
        digest: &[u8],
    ) -> PortResult<SendProgress> {
        let mut memory = self.0.lock().unwrap();
        assert_eq!(connection, memory.account.id);
        assert_eq!(channel, memory.conversation.channel_id);
        if memory.work.is_some() {
            if memory.digest != digest {
                return Err(MessagingError::Conflict.into());
            }
            return Ok(progress(&memory));
        }
        memory.digest = digest.to_vec();
        memory.work = Some(SendWork {
            lease: Lease {
                id: Uuid::now_v7(),
                token: Uuid::now_v7(),
            },
            connection_id: connection,
            channel_id: channel,
            user_id: user.into(),
            created_at: Utc::now(),
            request: request.clone(),
            rendered_text: None,
            attempts: 1,
        });
        Ok(progress(&memory))
    }
    async fn sends(&self, _: Uuid) -> PortResult<Vec<SendProgress>> {
        let memory = self.0.lock().unwrap();
        Ok(memory
            .work
            .as_ref()
            .map(|_| progress(&memory))
            .into_iter()
            .collect())
    }
    async fn sends_for_messages(&self, _: Uuid, _: &[Uuid]) -> PortResult<Vec<SendProgress>> {
        Ok(vec![])
    }
    async fn claim_send(&self) -> PortResult<Option<SendWork>> {
        let mut memory = self.0.lock().unwrap();
        if memory.state != DeliveryState::Pending {
            return Ok(None);
        }
        memory.state = DeliveryState::Sending;
        Ok(memory.work.clone())
    }
    async fn accepted_sends(&self) -> PortResult<Vec<(SendWork, ProviderId)>> {
        let memory = self.0.lock().unwrap();
        if memory.state != DeliveryState::Accepted {
            return Ok(vec![]);
        }
        Ok(vec![(
            memory.work.clone().unwrap(),
            memory.provider_id.clone().unwrap(),
        )])
    }
    async fn defer_accepted_send(&self, _: &SendWork, _: &ProviderId) -> PortResult<()> {
        Ok(())
    }
    async fn prepare_send(
        &self,
        lease: &Lease,
        account: &AccountScope,
        rendered_text: &str,
    ) -> PortResult<()> {
        let mut memory = self.0.lock().unwrap();
        if memory.account != *account
            || memory.account.status != ConnectionStatus::Connected
            || memory.state != DeliveryState::Sending
            || memory.work.as_ref().unwrap().lease.token != lease.token
        {
            return Err(MessagingError::Conflict.into());
        }
        memory.fences += 1;
        memory.work.as_mut().unwrap().rendered_text = Some(rendered_text.into());
        Ok(())
    }
    async fn settle_send(
        &self,
        _: &Lease,
        state: DeliveryState,
        provider: Option<&ProviderId>,
        _: Option<&str>,
        _: Option<u32>,
    ) -> PortResult<()> {
        let mut memory = self.0.lock().unwrap();
        if memory
            .fail_settle
            .take_if(|failing| *failing == state)
            .is_some()
        {
            return Err(MessagingError::Unavailable.into());
        }
        memory.state = state;
        memory.provider_id = provider.cloned();
        Ok(())
    }
}
#[async_trait]
impl ReplyPolicy for Fixture {
    async fn evaluate(
        &self,
        _: &AccountScope,
        _: &Conversation,
        now: chrono::DateTime<Utc>,
    ) -> PortResult<ReplyOptions> {
        let allowed = self.0.lock().unwrap().policy_allowed;
        Ok(ReplyOptions {
            capabilities: ReplyCapabilities {
                modes: vec![ReplyMode::FreeForm],
                text_limit: 200,
                text_limit_in_bytes: false,
                media: vec![],
                max_attachments: 0,
            },
            eligibility: ReplyEligibility {
                evaluated_at: now,
                modes: vec![ModeEligibility {
                    mode: ReplyMode::FreeForm,
                    allowed,
                    reason: (!allowed).then_some(ReplyBlockReason::WindowClosed),
                    expires_at: None,
                }],
            },
        })
    }
    async fn validate_content(&self, _: &AccountScope, _: &SendReply) -> PortResult<()> {
        if !self.0.lock().unwrap().content_allowed {
            return Err(MessagingError::Invalid("content approval changed").into());
        }
        Ok(())
    }
}
#[async_trait]
impl ReplyTransport for Transport {
    async fn prepare(
        &self,
        _: &AccountScope,
        _: &Conversation,
        request: &SendReply,
        media: Option<&OutboundMedia>,
    ) -> PortResult<Box<dyn PreparedSend>> {
        assert!(media.is_none());
        let ReplyContent::Text { text } = &request.message else {
            panic!("text-only test transport");
        };
        let mut memory = self.0.0.lock().unwrap();
        memory.preparations += 1;
        match memory.change {
            DuringPreparation::None => {}
            DuringPreparation::RevokeAccess => memory.access = false,
            DuringPreparation::Disconnect => memory.account.status = ConnectionStatus::Disconnected,
            DuringPreparation::Reconnect => {
                memory.account.generation = Some(Utc::now() + chrono::Duration::seconds(1))
            }
            DuringPreparation::MoveTeam => memory.account.team_id = Uuid::now_v7(),
            DuringPreparation::ChangeRecipient => {
                memory.conversation.customer_id = "another-customer".to_owned().try_into().unwrap()
            }
            DuringPreparation::ClosePolicy => memory.policy_allowed = false,
            DuringPreparation::RejectContent => memory.content_allowed = false,
            DuringPreparation::ExpireLease => {
                memory.work.as_mut().unwrap().lease.token = Uuid::now_v7()
            }
        }
        Ok(Box::new(Prepared(self.0.clone(), text.clone())))
    }
}
#[async_trait]
impl PreparedSend for Prepared {
    fn rendered_text(&self) -> &str {
        &self.1
    }
    async fn dispatch(self: Box<Self>) -> PortResult<ProviderSendResult> {
        let mut memory = self.0.0.lock().unwrap();
        assert_eq!(memory.fences, 1);
        memory.dispatches += 1;
        Ok(if memory.unknown {
            ProviderSendResult::Unknown
        } else {
            ProviderSendResult::Accepted("accepted-message".to_owned().try_into().unwrap())
        })
    }
}
#[async_trait]
impl NativeConversation for Fixture {
    async fn require_send(&self, _: Uuid, _: Uuid, _: &str) -> PortResult<()> {
        let mut memory = self.0.lock().unwrap();
        if memory.unavailable_checks > 0 {
            memory.unavailable_checks -= 1;
            return Err(MessagingError::Unavailable.into());
        }
        if !memory.access {
            return Err(MessagingError::Forbidden.into());
        }
        Ok(())
    }
    async fn upload_attachment(
        &self,
        _: &str,
        _: Uuid,
        _: MediaBytes,
    ) -> PortResult<UploadedAttachment> {
        Err(MessagingError::Invalid("text only").into())
    }
    async fn outgoing_media(&self, _: &str, _: Uuid, _: Uuid) -> PortResult<OutboundMedia> {
        Err(MessagingError::Invalid("text only").into())
    }
    async fn sent(
        &self,
        work: &SendWork,
        _: &Conversation,
        _: &AccountScope,
        _: &ProviderId,
    ) -> PortResult<()> {
        let mut memory = self.0.lock().unwrap();
        assert_eq!(
            memory.state,
            DeliveryState::Accepted,
            "acceptance must precede native materialization"
        );
        assert_eq!(
            work.rendered_text.as_deref(),
            Some("A deliberate text reply")
        );
        memory.materializations += 1;
        if memory.fail_native {
            return Err(MessagingError::Unavailable.into());
        }
        memory.state = DeliveryState::Sent;
        Ok(())
    }
    async fn reconcile_effects(&self) -> PortResult<()> {
        Ok(())
    }
}

#[tokio::test]
async fn non_meta_text_transport_needs_no_oauth_templates_history_or_reply_window() {
    let (service, fixture) = fixture();
    let receipt = receipt(&fixture);
    let state = service
        .conversation_view(
            &receipt.clone().try_into_requirement().unwrap(),
            SendAuthority::Human,
        )
        .await
        .unwrap()
        .unwrap();
    assert!(
        state
            .eligibility
            .require(ReplyMode::FreeForm, Utc::now())
            .is_ok()
    );
    assert_eq!(state.capabilities.modes, vec![ReplyMode::FreeForm]);
    service
        .send_reply(&receipt, request(), SendAuthority::Human)
        .await
        .unwrap();
    let work = fixture.claim_send().await.unwrap().unwrap();
    service.process_send(&work).await.unwrap();
    let memory = fixture.0.lock().unwrap();
    assert_eq!(
        (
            memory.preparations,
            memory.fences,
            memory.dispatches,
            memory.materializations
        ),
        (1, 1, 1, 1)
    );
}

#[tokio::test]
async fn provider_allow_never_grants_macro_access_or_human_authority() {
    for authority in [SendAuthority::Human, SendAuthority::DraftOnly] {
        let (service, fixture) = fixture();
        let receipt = receipt(&fixture);
        fixture.0.lock().unwrap().access = authority == SendAuthority::DraftOnly;
        let state = service
            .conversation_view(&receipt.clone().try_into_requirement().unwrap(), authority)
            .await
            .unwrap()
            .unwrap();
        assert!(
            state
                .eligibility
                .require(ReplyMode::FreeForm, Utc::now())
                .is_err()
        );
        assert_eq!(
            service
                .send_reply(&receipt, request(), authority)
                .await
                .unwrap_err()
                .current_context(),
            &MessagingError::Forbidden
        );
        let memory = fixture.0.lock().unwrap();
        assert!(memory.work.is_none());
        assert_eq!(memory.dispatches, 0);
    }
}

#[tokio::test]
async fn preparation_cannot_bypass_current_access_policy_generation_or_lease() {
    for change in [
        DuringPreparation::RevokeAccess,
        DuringPreparation::Disconnect,
        DuringPreparation::Reconnect,
        DuringPreparation::MoveTeam,
        DuringPreparation::ChangeRecipient,
        DuringPreparation::ClosePolicy,
        DuringPreparation::RejectContent,
        DuringPreparation::ExpireLease,
    ] {
        let (service, fixture) = fixture();
        service
            .send_reply(&receipt(&fixture), request(), SendAuthority::Human)
            .await
            .unwrap();
        fixture.0.lock().unwrap().change = change;
        let work = fixture.claim_send().await.unwrap().unwrap();
        assert!(service.process_send(&work).await.is_err());
        let memory = fixture.0.lock().unwrap();
        assert_eq!(memory.preparations, 1);
        assert_eq!((memory.fences, memory.dispatches), (0, 0));
        // Nothing reached the provider, so the service may settle this as failed.
        assert_eq!(memory.state, DeliveryState::Failed);
    }
}

#[tokio::test]
async fn transient_failures_before_the_fence_retry_without_dispatching() {
    let (service, fixture) = fixture();
    service
        .send_reply(&receipt(&fixture), request(), SendAuthority::Human)
        .await
        .unwrap();
    fixture.0.lock().unwrap().unavailable_checks = 1;
    let work = fixture.claim_send().await.unwrap().unwrap();
    service.process_send(&work).await.unwrap();
    assert_eq!(fixture.0.lock().unwrap().state, DeliveryState::Pending);
    assert_eq!(fixture.0.lock().unwrap().dispatches, 0);
    let work = fixture.claim_send().await.unwrap().unwrap();
    service.process_send(&work).await.unwrap();
    let memory = fixture.0.lock().unwrap();
    assert_eq!((memory.dispatches, memory.state), (1, DeliveryState::Sent));
}

#[tokio::test]
async fn unrecorded_acceptance_is_never_settled_as_a_failed_send() {
    let (service, fixture) = fixture();
    service
        .send_reply(&receipt(&fixture), request(), SendAuthority::Human)
        .await
        .unwrap();
    fixture.0.lock().unwrap().fail_settle = Some(DeliveryState::Accepted);
    // Exercise the worker entry point, which owns the failure fallback.
    assert!(service.process_next_send().await.is_err());
    let memory = fixture.0.lock().unwrap();
    assert_eq!(memory.dispatches, 1);
    // The attempt stays leased; expiry records Unknown, so no resend is offered.
    assert_eq!(memory.state, DeliveryState::Sending);
    assert_eq!(memory.provider_id, None);
}

#[tokio::test]
async fn durable_acceptance_recovers_native_content_without_resending() {
    let (service, fixture) = fixture();
    service
        .send_reply(&receipt(&fixture), request(), SendAuthority::Human)
        .await
        .unwrap();
    fixture.0.lock().unwrap().fail_native = true;
    let work = fixture.claim_send().await.unwrap().unwrap();
    assert!(service.process_send(&work).await.is_err());
    assert_eq!(fixture.0.lock().unwrap().state, DeliveryState::Accepted);
    fixture.0.lock().unwrap().fail_native = false;
    fixture.0.lock().unwrap().access = false;
    service.recover_native().await.unwrap();
    service.recover_native().await.unwrap();
    let memory = fixture.0.lock().unwrap();
    assert_eq!((memory.dispatches, memory.materializations), (1, 2));
}

#[tokio::test]
async fn unknown_outcomes_are_not_claimed_or_recovered_as_new_sends() {
    let (service, fixture) = fixture();
    service
        .send_reply(&receipt(&fixture), request(), SendAuthority::Human)
        .await
        .unwrap();
    fixture.0.lock().unwrap().unknown = true;
    let work = fixture.claim_send().await.unwrap().unwrap();
    service.process_send(&work).await.unwrap();
    assert!(fixture.claim_send().await.unwrap().is_none());
    service.recover_native().await.unwrap();
    let memory = fixture.0.lock().unwrap();
    assert_eq!(memory.state, DeliveryState::Unknown);
    assert_eq!((memory.dispatches, memory.materializations), (1, 0));
}

#[tokio::test]
async fn unsupported_operations_are_rejected_before_preparing_transport() {
    let (service, fixture) = fixture();
    let mut unsupported = request();
    unsupported.human_support = true;
    assert!(
        service
            .send_reply(&receipt(&fixture), unsupported, SendAuthority::Human)
            .await
            .is_err()
    );
    let memory = fixture.0.lock().unwrap();
    assert!(memory.work.is_none());
    assert_eq!(memory.preparations, 0);
}

#[test]
fn original_queued_requests_keep_v1_serialization_and_hashes() {
    for (payload, expected) in [
        (
            include_str!("fixtures/queued-text-v1.json"),
            "e978b1016e7b2b938941bd3eb2325f2ff32d1517f7a25f4f8a7fdeaa5d1ac2a2",
        ),
        (
            include_str!("fixtures/queued-media-v1.json"),
            "6e28739bd186612a492af121ecc97f0426c041561bad3d9125218e104cccd2ad",
        ),
        (
            include_str!("fixtures/queued-template-v1.json"),
            "0cf54bb8b7d5c5e36fb5477563ed55dcb49e2544e756d3757258722209fadfa2",
        ),
    ] {
        let request: SendReply = serde_json::from_str(payload).unwrap();
        assert!(!request.human_support);
        assert!(request.reply_to.is_none());
        let digest = Sha256::digest(serde_json::to_vec(&request).unwrap());
        assert_eq!(format!("{digest:x}"), expected);
        let mut accepted: serde_json::Value = serde_json::from_str(payload).unwrap();
        accepted["rendered_text"] = "Retained prepared content".into();
        let recovered: SendReply = serde_json::from_value(accepted).unwrap();
        assert_eq!(
            serde_json::to_vec(&recovered).unwrap(),
            serde_json::to_vec(&request).unwrap()
        );
    }
}
