use super::*;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::link::{Link, UserProvider};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

pub(super) const LINK: Uuid = Uuid::from_u128(100);
pub(super) const WRITE: Uuid = Uuid::from_u128(200);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Call {
    Link,
    Turns(Vec<Uuid>, Vec<String>, Uuid),
    Abandon(Vec<Uuid>, Uuid),
    Confirm(Vec<Uuid>, Uuid),
    Revert(Vec<Uuid>, LabelWriteRevert),
    One(String, Vec<String>, Vec<String>, bool),
    Batch(Vec<String>, Vec<String>, Vec<String>),
    Delete(String),
    Block(String),
    Unblock(String),
    Retry(String),
}

#[derive(Default)]
pub(super) struct State {
    pub calls: Vec<Call>,
    pub missing_link: bool,
    pub fault: Option<&'static str>,
    pub turns: VecDeque<HashMap<Uuid, LabelWriteTurn>>,
    pub replies: VecDeque<Result<(), EmailApiError>>,
    settled: HashSet<Uuid>,
}

#[derive(Clone, Default)]
pub(super) struct Fake(pub Arc<Mutex<State>>);

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(super) struct FakeError(&'static str);

impl ConnectionSourceError for FakeError {
    fn into_original(self) -> anyhow::Error {
        anyhow::anyhow!(self.0)
    }
}

impl Fake {
    fn record(&self, name: &'static str, call: Call) -> Result<(), FakeError> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(call);
        if state.fault == Some(name) {
            Err(FakeError(name))
        } else {
            Ok(())
        }
    }

    fn provider(&self, call: Call) -> Result<(), EmailApiError> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(call);
        state.replies.pop_front().unwrap_or(Ok(()))
    }

    pub fn calls(&self) -> Vec<Call> {
        self.0.lock().unwrap().calls.clone()
    }
}

pub(super) fn make_service(retry_worker: bool) -> (GmailOpsService<Fake, Fake, Fake>, Fake) {
    let fake = Fake::default();
    (
        GmailOpsService {
            repository: fake.clone(),
            gmail: fake.clone(),
            retry_queue: fake.clone(),
            retry_worker,
        },
        fake,
    )
}

pub(super) fn message(count: usize, marked: bool) -> GmailOpsPubsubMessage {
    GmailOpsPubsubMessage {
        link_id: LINK,
        operation: GmailOpsOperation::ModifyMessageLabelsBatch(ModifyMessageLabelsBatchPayload {
            messages: (1..=count)
                .map(|id| GmailMessageRef {
                    db_message_id: Uuid::from_u128(id as u128),
                    provider_message_id: format!("m{id}"),
                })
                .collect(),
            labels_to_add: vec!["Label_work".into()],
            labels_to_remove: vec![],
            pending_write_id: marked.then_some(WRITE),
        }),
    }
}

pub(super) fn payload(message: &mut GmailOpsPubsubMessage) -> &mut ModifyMessageLabelsBatchPayload {
    match &mut message.operation {
        GmailOpsOperation::ModifyMessageLabelsBatch(payload) => payload,
        _ => panic!("batch fixture"),
    }
}

pub(super) fn turns(entries: &[(u128, LabelWriteTurn)]) -> HashMap<Uuid, LabelWriteTurn> {
    entries
        .iter()
        .map(|(id, turn)| (Uuid::from_u128(*id), *turn))
        .collect()
}

pub(super) fn ids(values: &[u128]) -> Vec<Uuid> {
    values.iter().copied().map(Uuid::from_u128).collect()
}

impl GmailOpsLinks for Fake {
    type Err = FakeError;
    async fn link(&self, id: Uuid) -> Result<Option<Link>, Self::Err> {
        assert_eq!(id, LINK);
        self.record("link", Call::Link)?;
        Ok((!self.0.lock().unwrap().missing_link).then(|| Link {
            id: LINK,
            macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
            fusionauth_user_id: "owner".into(),
            email_address: EmailStr::try_from("inbox@example.com".to_string()).unwrap(),
            provider: UserProvider::Gmail,
            is_sync_active: true,
            is_primary: false,
            needs_reauth: false,
            last_sync_error_at: None,
            created_at: Default::default(),
            updated_at: Default::default(),
        }))
    }
}

impl GmailLabelWrites for Fake {
    type Err = FakeError;
    async fn turns(
        &self,
        messages: &[Uuid],
        labels: &[String],
        write: Uuid,
    ) -> Result<HashMap<Uuid, LabelWriteTurn>, Self::Err> {
        self.record(
            "turns",
            Call::Turns(messages.to_vec(), labels.to_vec(), write),
        )?;
        let mut state = self.0.lock().unwrap();
        Ok(state.turns.pop_front().unwrap_or_else(|| {
            messages
                .iter()
                .map(|id| {
                    (
                        *id,
                        if state.settled.contains(id) {
                            LabelWriteTurn::Superseded
                        } else {
                            LabelWriteTurn::Send
                        },
                    )
                })
                .collect()
        }))
    }

    async fn abandon(&self, link: Uuid, messages: &[Uuid], write: Uuid) -> Result<(), Self::Err> {
        assert_eq!(link, LINK);
        self.record("abandon", Call::Abandon(messages.to_vec(), write))?;
        self.0.lock().unwrap().settled.extend(messages);
        Ok(())
    }

    async fn confirm(&self, link: Uuid, messages: &[Uuid], write: Uuid) -> Result<(), Self::Err> {
        assert_eq!(link, LINK);
        self.record("confirm", Call::Confirm(messages.to_vec(), write))?;
        self.0.lock().unwrap().settled.extend(messages);
        Ok(())
    }

    async fn revert(
        &self,
        link: Uuid,
        messages: Vec<Uuid>,
        change: LabelWriteRevert,
    ) -> Result<Vec<Uuid>, Self::Err> {
        assert_eq!(link, LINK);
        self.record("revert", Call::Revert(messages.clone(), change))?;
        self.0.lock().unwrap().settled.extend(&messages);
        Ok(messages)
    }
}

impl GmailMailboxOperations for Fake {
    async fn modify_message_labels(
        &self,
        link: Uuid,
        messages: &[String],
        add: &[String],
        remove: &[String],
    ) -> Result<(), EmailApiError> {
        assert_eq!(link, LINK);
        self.provider(Call::Batch(
            messages.to_vec(),
            add.to_vec(),
            remove.to_vec(),
        ))
    }

    async fn modify_one_message_labels(
        &self,
        link: Uuid,
        message: &str,
        add: &[String],
        remove: &[String],
        skip_missing: bool,
    ) -> Result<(), EmailApiError> {
        assert_eq!(link, LINK);
        self.provider(Call::One(
            message.into(),
            add.to_vec(),
            remove.to_vec(),
            skip_missing,
        ))
    }

    async fn delete_label(&self, link: Uuid, label: &str) -> Result<(), EmailApiError> {
        assert_eq!(link, LINK);
        self.provider(Call::Delete(label.into()))
    }

    async fn block_sender(&self, link: Uuid, address: &str) -> Result<(), EmailApiError> {
        assert_eq!(link, LINK);
        self.provider(Call::Block(address.into()))
    }

    async fn unblock_sender(&self, link: Uuid, address: &str) -> Result<(), EmailApiError> {
        assert_eq!(link, LINK);
        self.provider(Call::Unblock(address.into()))
    }
}

impl GmailOpsRetryQueue for Fake {
    type Err = FakeError;
    async fn enqueue(&self, message: GmailOpsPubsubMessage) -> Result<(), Self::Err> {
        self.record(
            "enqueue",
            Call::Retry(serde_json::to_string(&message).unwrap()),
        )
    }
}
