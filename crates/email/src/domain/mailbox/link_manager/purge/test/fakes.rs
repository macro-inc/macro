use super::*;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

pub(super) const LINK: Uuid = Uuid::from_u128(100);
pub(super) fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}
pub(super) fn limit(n: u32) -> NonZeroU32 {
    NonZeroU32::new(n).unwrap()
}
pub(super) fn message(n: u128, thread: u128) -> PurgeMessage {
    PurgeMessage {
        id: id(n),
        thread_id: id(thread),
    }
}
pub(super) fn contact(n: u128, email: &str) -> PurgeContact {
    PurgeContact {
        id: id(n),
        email_address: email.into(),
    }
}
pub(super) fn pacing(pause: Duration) -> PurgePacing {
    PurgePacing {
        messages: limit(2),
        threads: limit(2),
        contacts: limit(2),
        pause,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Call {
    Mark(Uuid),
    Begin(Uuid),
    Messages(Uuid, u32),
    Threads(u32),
    Contacts(String, u32),
    Rows(&'static str, Vec<Uuid>),
    Marked(Uuid),
    Commit,
    Rollback,
}
#[derive(Debug, thiserror::Error)]
#[error("{0} failure #{1}")]
pub(super) struct Failure(pub &'static str, pub usize);

#[derive(Default)]
pub(super) struct State {
    pub messages: VecDeque<Vec<PurgeMessage>>,
    pub threads: VecDeque<Vec<Uuid>>,
    pub contacts: VecDeque<Vec<PurgeContact>>,
    pub row_counts: HashMap<&'static str, u64>,
    pub counts: HashMap<&'static str, usize>,
    pub failure: Option<(&'static str, usize)>,
    calls: Vec<Call>,
}
#[derive(Clone, Default)]
pub(super) struct Fake(pub Arc<Mutex<State>>);
pub(super) struct Tx {
    fake: Fake,
    settled: bool,
}
impl Fake {
    pub fn calls(&self) -> Vec<Call> {
        self.0.lock().unwrap().calls.clone()
    }
    fn step(&self, point: &'static str, call: Call) -> anyhow::Result<()> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(call);
        let count = state.counts.entry(point).or_default();
        *count += 1;
        let count = *count;
        if state.failure == Some((point, count)) {
            return Err(Failure(point, count).into());
        }
        Ok(())
    }
    fn rows(&self, point: &'static str, ids: &[Uuid]) -> anyhow::Result<u64> {
        self.step(point, Call::Rows(point, ids.to_vec()))?;
        Ok(self
            .0
            .lock()
            .unwrap()
            .row_counts
            .get(point)
            .copied()
            .unwrap_or(ids.len() as u64))
    }
}
impl Drop for Tx {
    fn drop(&mut self) {
        if !self.settled {
            self.fake.0.lock().unwrap().calls.push(Call::Rollback);
        }
    }
}
impl LinkPurgeRepository for Fake {
    type Transaction = Tx;
    async fn mark_link_deleting(&self, link: Uuid) -> anyhow::Result<()> {
        self.step("mark", Call::Mark(link))
    }
    async fn begin_batch(&self, link: Uuid) -> anyhow::Result<Tx> {
        self.step("begin", Call::Begin(link))?;
        Ok(Tx {
            fake: self.clone(),
            settled: false,
        })
    }
}
impl LinkPurgeTransaction for Tx {
    async fn messages(
        &mut self,
        link: Uuid,
        cursor: Uuid,
        limit: NonZeroU32,
    ) -> anyhow::Result<Vec<PurgeMessage>> {
        assert_eq!(link, LINK);
        self.fake
            .step("select_messages", Call::Messages(cursor, limit.get()))?;
        Ok(self
            .fake
            .0
            .lock()
            .unwrap()
            .messages
            .pop_front()
            .unwrap_or_default())
    }
    async fn delete_message_labels(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        self.fake.rows("labels", ids).map(|_| ())
    }
    async fn delete_message_recipients(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        self.fake.rows("recipients", ids).map(|_| ())
    }
    async fn detach_message_files(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        self.fake.rows("files", ids).map(|_| ())
    }
    async fn delete_message_attachments(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        self.fake.rows("attachments", ids).map(|_| ())
    }
    async fn delete_scheduled_messages(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        self.fake.rows("scheduled", ids).map(|_| ())
    }
    async fn delete_message_rows(&mut self, ids: &[Uuid]) -> anyhow::Result<u64> {
        self.fake.rows("messages", ids)
    }
    async fn delete_thread_history(&mut self, link: Uuid, ids: &[Uuid]) -> anyhow::Result<()> {
        assert_eq!(link, LINK);
        self.fake.rows("history", ids).map(|_| ())
    }
    async fn delete_thread_rows(&mut self, link: Uuid, ids: &[Uuid]) -> anyhow::Result<u64> {
        assert_eq!(link, LINK);
        self.fake.rows("thread_rows", ids)
    }
    async fn threads(&mut self, link: Uuid, limit: NonZeroU32) -> anyhow::Result<Vec<Uuid>> {
        assert_eq!(link, LINK);
        self.fake
            .step("select_threads", Call::Threads(limit.get()))?;
        Ok(self
            .fake
            .0
            .lock()
            .unwrap()
            .threads
            .pop_front()
            .unwrap_or_default())
    }
    async fn contacts(
        &mut self,
        link: Uuid,
        cursor: &str,
        limit: NonZeroU32,
    ) -> anyhow::Result<Vec<PurgeContact>> {
        assert_eq!(link, LINK);
        self.fake.step(
            "select_contacts",
            Call::Contacts(cursor.into(), limit.get()),
        )?;
        Ok(self
            .fake
            .0
            .lock()
            .unwrap()
            .contacts
            .pop_front()
            .unwrap_or_default())
    }
    async fn delete_contact_rows(&mut self, ids: &[Uuid]) -> anyhow::Result<u64> {
        self.fake.rows("contact_rows", ids)
    }
    async fn delete_marked_link(&mut self, link: Uuid) -> anyhow::Result<u64> {
        self.fake.step("marked", Call::Marked(link))?;
        Ok(self
            .fake
            .0
            .lock()
            .unwrap()
            .row_counts
            .get("marked")
            .copied()
            .unwrap_or(1))
    }
    async fn commit(mut self) -> anyhow::Result<()> {
        self.settled = true;
        self.fake.step("commit", Call::Commit)
    }
}

pub(super) fn service() -> (LinkPurgeService<Fake>, Fake) {
    let fake = Fake::default();
    (
        LinkPurgeService {
            repository: fake.clone(),
        },
        fake,
    )
}
pub(super) fn seeded_service() -> (LinkPurgeService<Fake>, Fake) {
    let (service, fake) = service();
    {
        let mut s = fake.0.lock().unwrap();
        s.messages.push_back(vec![message(1, 10)]);
        s.threads.push_back(vec![id(20)]);
        s.contacts.push_back(vec![contact(30, "a")]);
    }
    (service, fake)
}
pub(super) fn message_calls(limit: u32, messages: &[u128], finished: &[Uuid]) -> Vec<Call> {
    let mut calls = vec![Call::Begin(LINK), Call::Messages(Uuid::nil(), limit)];
    for point in [
        "labels",
        "recipients",
        "files",
        "attachments",
        "scheduled",
        "messages",
    ] {
        calls.push(Call::Rows(
            point,
            messages.iter().copied().map(id).collect(),
        ));
    }
    if !finished.is_empty() {
        calls.push(Call::Rows("history", finished.to_vec()));
        calls.push(Call::Rows("thread_rows", finished.to_vec()));
    }
    calls.push(Call::Commit);
    calls
}
