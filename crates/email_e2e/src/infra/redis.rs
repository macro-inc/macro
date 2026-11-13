//! One Redis logical database per scenario, on the suite's Redis server.
//!
//! Scenarios run as separate processes, so the databases are handed out
//! through leases held in database 0 of the same server.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use redis::aio::MultiplexedConnection;
use rootcause::prelude::*;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

/// How long a lease outlives a scenario that died without releasing it.
const LEASE: Duration = Duration::from_secs(30);
const RENEW_EVERY: Duration = Duration::from_secs(10);
/// How long to wait for a database while other scenarios hold them all.
const LEASE_WAIT: Duration = Duration::from_secs(300);
const LEASE_RETRY: Duration = Duration::from_millis(500);

/// Releases the lease only while this scenario still owns it.
const RELEASE: &str = r#"
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"#;

/// Extends the lease only while this scenario still owns it.
const RENEW: &str = r#"
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
"#;

/// A leased logical database, emptied when it was taken.
pub(crate) struct RedisDatabase {
    url: String,
    lease_key: String,
    owner: String,
    registry: MultiplexedConnection,
    /// Set when a renewal found the lease expired or held by someone else.
    lost: Arc<AtomicBool>,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

impl RedisDatabase {
    /// Leases a free logical database and empties it.
    pub(crate) async fn lease(server_url: &str) -> Result<Self, Report> {
        let server = server_url.trim_end_matches('/');
        let client = redis::Client::open(format!("{server}/0"))
            .context("the Redis server address (EMAIL_E2E_REDIS_URL) is not a Redis URL")?;
        let mut registry = client
            .get_multiplexed_async_connection()
            .await
            .context("could not connect to the Redis server (EMAIL_E2E_REDIS_URL)")?;

        let databases: Vec<String> = redis::cmd("CONFIG")
            .arg("GET")
            .arg("databases")
            .query_async(&mut registry)
            .await
            .context("could not read how many databases the Redis server has")?;
        let count: u32 = databases
            .get(1)
            .and_then(|count| count.parse().ok())
            .ok_or_else(|| report!("the Redis server did not say how many databases it has"))?;

        let owner = Uuid::now_v7().to_string();
        let index = lease_index(&mut registry, count, &owner).await?;
        let url = format!("{server}/{index}");

        let mut database = redis::Client::open(url.as_str())?
            .get_multiplexed_async_connection()
            .await?;
        redis::cmd("FLUSHDB")
            .query_async::<()>(&mut database)
            .await
            .context("could not empty the scenario's Redis database")?;

        let lease_key = lease_key(index);
        let cancel = CancellationToken::new();
        let tracker = TaskTracker::new();
        let lost = Arc::new(AtomicBool::new(false));
        tracker.spawn(renew(
            registry.clone(),
            lease_key.clone(),
            owner.clone(),
            lost.clone(),
            cancel.clone(),
        ));

        Ok(Self {
            url,
            lease_key,
            owner,
            registry,
            lost,
            cancel,
            tracker,
        })
    }

    /// The URL the services connect with.
    pub(crate) fn url(&self) -> &str {
        &self.url
    }

    /// Fails when the lease ran out while the scenario was using the
    /// database: another scenario may have taken and emptied it since.
    pub(crate) fn ensure_held(&self) -> Result<(), Report> {
        if self.lost.load(Ordering::Relaxed) {
            bail!(
                "the scenario lost its Redis database lease ({}): renewals stalled for over {LEASE:?}",
                self.lease_key
            );
        }
        Ok(())
    }

    /// Gives the database back.
    pub(crate) async fn release(mut self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
        let released: Result<i32, _> = redis::Script::new(RELEASE)
            .key(&self.lease_key)
            .arg(&self.owner)
            .invoke_async(&mut self.registry)
            .await;
        if let Err(error) = released {
            tracing::warn!(error = ?error, "could not release the Redis database lease");
        }
    }
}

fn lease_key(index: u32) -> String {
    format!("email_e2e:lease:{index}")
}

/// Takes the first database nobody holds, waiting while all are held.
/// Database 0 holds the leases and is never handed out.
async fn lease_index(
    registry: &mut MultiplexedConnection,
    count: u32,
    owner: &str,
) -> Result<u32, Report> {
    let deadline = tokio::time::Instant::now() + LEASE_WAIT;
    loop {
        for index in 1..count {
            let taken: bool = redis::cmd("SET")
                .arg(lease_key(index))
                .arg(owner)
                .arg("NX")
                .arg("PX")
                .arg(LEASE.as_millis() as u64)
                .query_async(registry)
                .await?;
            if taken {
                return Ok(index);
            }
        }

        if tokio::time::Instant::now() >= deadline {
            bail!(
                "all {} Redis databases stayed leased for {LEASE_WAIT:?}; run fewer scenarios at once",
                count.saturating_sub(1)
            );
        }
        // Another process holds the lease, so nothing here can signal its release.
        tokio::time::sleep(LEASE_RETRY).await;
    }
}

async fn renew(
    mut registry: MultiplexedConnection,
    lease_key: String,
    owner: String,
    lost: Arc<AtomicBool>,
    cancel: CancellationToken,
) {
    loop {
        tokio::select! {
            () = cancel.cancelled() => return,
            () = tokio::time::sleep(RENEW_EVERY) => {}
        }
        let renewed: Result<i32, _> = redis::Script::new(RENEW)
            .key(&lease_key)
            .arg(&owner)
            .arg(LEASE.as_millis() as u64)
            .invoke_async(&mut registry)
            .await;
        match renewed {
            Ok(0) => {
                lost.store(true, Ordering::Relaxed);
                return;
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(error = ?error, "could not renew the Redis database lease");
            }
        }
    }
}
