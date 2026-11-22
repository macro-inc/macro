//! Bounded process-local proof and fleet protection for saved-credential damage.
use std::collections::BTreeMap;
use tokio::time::Instant;
use uuid::Uuid;

const WINDOW: std::time::Duration = std::time::Duration::from_secs(600);
const ACCOUNTS: usize = 2048;
const MAX_UNREADABLE_PERCENT: usize = 5;
const CIPHERTEXT_BYTES: usize = 8192;

#[derive(Clone)]
pub(super) struct KnownGood {
    pub key_arn: String,
    pub ciphertext: Vec<u8>,
    context: [u8; 32],
    at: Instant,
}

struct Observation {
    seen: Instant,
    unreadable: bool,
    good: Option<KnownGood>,
}

#[derive(Default)]
pub(super) struct Health(BTreeMap<Uuid, Observation>);

impl Health {
    pub fn observe(&mut self, id: Uuid) {
        let now = Instant::now();
        self.0
            .retain(|_, entry| now.duration_since(entry.seen) < WINDOW);
        if !self.0.contains_key(&id)
            && self.0.len() >= ACCOUNTS
            && let Some(oldest) = self
                .0
                .iter()
                .min_by_key(|(_, entry)| entry.seen)
                .map(|(id, _)| *id)
        {
            self.0.remove(&oldest);
        }
        self.0
            .entry(id)
            .or_insert(Observation {
                seen: now,
                unreadable: false,
                good: None,
            })
            .seen = now;
    }

    pub fn success(
        &mut self,
        id: Uuid,
        context: [u8; 32],
        key_arn: Option<String>,
        ciphertext: &[u8],
    ) {
        self.observe(id);
        if let Some(entry) = self.0.get_mut(&id) {
            entry.unreadable = false;
            entry.good = key_arn
                .filter(|arn| arn.len() <= 2048)
                .filter(|_| ciphertext.len() <= CIPHERTEXT_BYTES)
                .map(|key_arn| KnownGood {
                    key_arn,
                    ciphertext: ciphertext.to_vec(),
                    context,
                    at: Instant::now(),
                });
        }
    }

    pub fn canary(&self, id: Uuid, context: [u8; 32], ciphertext: &[u8]) -> Option<KnownGood> {
        let good = self.0.get(&id)?.good.as_ref()?;
        (good.context == context && good.at.elapsed() < WINDOW && good.ciphertext != ciphertext)
            .then(|| good.clone())
    }

    /// Five percent of distinct observed accounts, never a request-count ratio.
    /// Below twenty accounts even one damaged credential stays transient.
    pub fn unreadable(&mut self, id: Uuid) -> bool {
        self.observe(id);
        if let Some(entry) = self.0.get_mut(&id) {
            entry.unreadable = true;
        }
        let unreadable = self.0.values().filter(|entry| entry.unreadable).count();
        let guarded = unreadable * 100 > self.0.len() * MAX_UNREADABLE_PERCENT;
        // One bounded span is one counter sample; the monitoring stack declares
        // its SpansMetric rather than querying sampled indexed spans.
        let span = tracing::info_span!(
            "imap.credentials.classification",
            credentials.unreadable_count = 1_u64,
            credentials.fleet_guard = guarded,
            credentials.observed_accounts = self.0.len(),
            credentials.unreadable_accounts = unreadable
        );
        span.in_scope(|| {
            if guarded {
                tracing::error!("Saved-credential fleet guard blocked automatic reconnect parking");
            }
        });
        !guarded
    }
}
