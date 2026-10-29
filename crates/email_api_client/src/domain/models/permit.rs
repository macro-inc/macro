use uuid::Uuid;

type Release = Box<dyn FnOnce(Uuid, Uuid) + Send + Sync>;

/// How busy a mailbox was when the gate admitted a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MailboxLoad {
    /// The mailbox's requests in flight, counting this one.
    pub in_flight: u32,
    /// The mailbox's in-flight cap when the request was admitted.
    pub cap: u32,
}

/// Admission for one provider request. A permit dropped before its gate
/// finishes it, by a cancelled caller or an abandoned send, hands itself to
/// the gate's release instead of holding its slot until the lease expires.
pub struct RequestPermit {
    link_id: Uuid,
    id: Uuid,
    load: Option<MailboxLoad>,
    release: Option<Release>,
}

impl RequestPermit {
    /// Creates a permit that runs `release` if it is dropped unfinished.
    pub fn new(
        link_id: Uuid,
        id: Uuid,
        release: impl FnOnce(Uuid, Uuid) + Send + Sync + 'static,
    ) -> Self {
        Self {
            link_id,
            id,
            load: None,
            release: Some(Box::new(release)),
        }
    }

    /// Records how busy the mailbox was when this request was admitted.
    pub fn with_load(mut self, load: MailboxLoad) -> Self {
        self.load = Some(load);
        self
    }

    /// How busy the mailbox was at admission, when the gate tracks it.
    pub fn load(&self) -> Option<MailboxLoad> {
        self.load
    }

    /// The mailbox this permit admits a request for.
    pub fn link_id(&self) -> Uuid {
        self.link_id
    }

    /// The gate's identifier for this admission.
    pub fn id(&self) -> Uuid {
        self.id
    }

    /// Records that the gate has finished this permit, so dropping it does nothing.
    pub fn disarm(mut self) {
        self.release = None;
    }
}

impl Drop for RequestPermit {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            release(self.link_id, self.id);
        }
    }
}
