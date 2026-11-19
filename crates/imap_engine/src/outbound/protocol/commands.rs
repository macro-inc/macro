//! A bounded spare command connection for one exact mailbox credential generation.
use super::*;
use std::{
    collections::BTreeMap,
    ops::{Deref, DerefMut},
    time::Instant,
};

pub(super) struct Command {
    session: Session<Stream>,
    opened: Instant,
    idle_since: Instant,
}
impl Deref for Command {
    type Target = Session<Stream>;
    fn deref(&self) -> &Self::Target {
        &self.session
    }
}
impl DerefMut for Command {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.session
    }
}
pub(super) type Pool = BTreeMap<String, Command>;
impl ProtocolTransport {
    pub(super) async fn reclaim_commands(&self) {
        self.command_pool.lock().await.retain(|_, s| {
            s.opened.elapsed() < Duration::from_secs(1800)
                && s.idle_since.elapsed() < Duration::from_secs(60)
        });
    }

    fn command_key(c: &Credentials) -> Option<String> {
        let b = c.binding?;
        let endpoint = serde_json::to_vec(&c.imap.endpoint).ok()?;
        Some(format!(
            "{}:{}:{}:{:x}",
            b.link_id,
            b.sync_generation,
            b.grant_generation,
            Sha256::digest(endpoint)
        ))
    }
    pub(super) async fn command_session(&self, c: &Credentials) -> Result<Command, Error> {
        let key = Self::command_key(c);
        let previous = {
            let mut pool = self.command_pool.lock().await;
            pool.retain(|_, s| {
                s.opened.elapsed() < Duration::from_secs(1800)
                    && s.idle_since.elapsed() < Duration::from_secs(60)
            });
            key.as_ref().and_then(|key| pool.remove(key))
        };
        if let Some(mut previous) = previous {
            // A failed liveness check has not emitted a user command and can safely reconnect.
            if timeout(Duration::from_secs(10), previous.noop())
                .await
                .is_ok_and(|r| r.is_ok())
            {
                return Ok(previous);
            }
        }
        let session = self.imap(&c.imap).await?;
        let now = Instant::now();
        Ok(Command {
            session,
            opened: now,
            idle_since: now,
        })
    }
    pub(super) async fn return_command(&self, c: &Credentials, mut connection: Command) {
        let Some(key) = Self::command_key(c) else {
            return;
        };
        if connection.opened.elapsed() >= Duration::from_secs(1800) {
            return;
        }
        connection.idle_since = Instant::now();
        let mut pool = self.command_pool.lock().await;
        pool.retain(|_, s| s.idle_since.elapsed() < Duration::from_secs(60));
        // Each account keeps at most one spare; global idle retention is independently bounded.
        if pool.len() < 64 || pool.contains_key(&key) {
            pool.insert(key, connection);
        }
    }
    pub(super) async fn evict_commands(&self, b: Binding) {
        let prefix = format!(
            "{}:{}:{}:",
            b.link_id, b.sync_generation, b.grant_generation
        );
        self.command_pool
            .lock()
            .await
            .retain(|key, _| !key.starts_with(&prefix));
    }
}
