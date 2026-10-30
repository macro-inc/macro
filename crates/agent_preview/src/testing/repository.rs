//! In-memory port for unit tests only.
use crate::domain::{storage::*, *};
use agent_fold::domain::log::AgentSessionId;
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Mutex,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
#[derive(Default)]
pub struct MemoryRepository(pub Mutex<Data>, pub std::sync::atomic::AtomicBool);
#[derive(Default)]
pub struct Data {
    pub leases: HashMap<AgentSessionId, StoredPreview>,
    pub credentials: HashMap<[u8; 32], (String, StoredCredential)>,
    pub accounts: HashMap<String, Instant>,
    pub replicas: HashMap<Uuid, (SocketAddr, i64)>,
}
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
fn live(d: &Data, p: &StoredPreview) -> bool {
    p.preview.expires_at > now() as u64
        && matches!(
            p.preview.status,
            PreviewStatus::Starting | PreviewStatus::Ready
        )
        && p.replica
            .is_none_or(|r| d.replicas.get(&r).is_some_and(|(_, e)| *e > now()))
}
#[async_trait]
impl PreviewRepository for MemoryRepository {
    async fn create(
        &self,
        p: StoredPreview,
        c: StoredCredential,
        limits: CreationLimits,
    ) -> Result<(), PreviewError> {
        let mut d = self.0.lock().unwrap();
        let user = p.user.to_string();
        if d.accounts
            .get(&user)
            .is_some_and(|i| i.elapsed().as_secs_f64() < limits.pace_seconds)
            || d.leases
                .values()
                .filter(|l| {
                    l.preview.expires_at > now() as u64
                        && l.preview.agent_session_id != p.preview.agent_session_id
                })
                .count()
                >= limits.total as usize
            || d.leases
                .values()
                .filter(|l| {
                    live(&d, l)
                        && l.user == p.user
                        && l.preview.agent_session_id != p.preview.agent_session_id
                })
                .count()
                >= limits.account as usize
        {
            return Err(PreviewError::Limited);
        }
        d.accounts.insert(user, Instant::now());
        if let Some(old) = d.leases.insert(p.preview.agent_session_id, p) {
            d.credentials
                .retain(|_, (_, c)| c.preview != old.preview.id);
        }
        d.credentials.insert(c.hash, ("ssh".into(), c));
        Ok(())
    }
    async fn session(&self, s: AgentSessionId) -> Result<Option<StoredPreview>, PreviewError> {
        let d = self.0.lock().unwrap();
        Ok(d.leases.get(&s).cloned().map(|mut p| {
            if !live(&d, &p)
                && matches!(
                    p.preview.status,
                    PreviewStatus::Starting | PreviewStatus::Ready
                )
            {
                p.preview.status = PreviewStatus::Offline;
            }
            p
        }))
    }
    async fn preview(&self, id: &PreviewId) -> Result<StoredPreview, PreviewError> {
        let d = self.0.lock().unwrap();
        d.leases
            .values()
            .find(|p| p.preview.id == *id && live(&d, p))
            .cloned()
            .ok_or(PreviewError::Offline)
    }
    async fn claim(&self, hash: [u8; 32], r: Uuid) -> Result<StoredPreview, PreviewError> {
        let mut d = self.0.lock().unwrap();
        let (k, c) = d
            .credentials
            .get(&hash)
            .cloned()
            .ok_or(PreviewError::Denied)?;
        if k != "ssh" || c.expires <= now() || !d.replicas.get(&r).is_some_and(|(_, e)| *e > now())
        {
            return Err(PreviewError::Denied);
        }
        d.credentials.remove(&hash);
        let p = d
            .leases
            .values_mut()
            .find(|p| {
                p.preview.id == c.preview
                    && p.replica.is_none()
                    && p.preview.status == PreviewStatus::Starting
            })
            .ok_or(PreviewError::Denied)?;
        p.replica = Some(r);
        Ok(p.clone())
    }
    async fn status(
        &self,
        id: &PreviewId,
        r: Uuid,
        status: PreviewStatus,
    ) -> Result<bool, PreviewError> {
        if self.1.swap(false, std::sync::atomic::Ordering::SeqCst) {
            return Err(PreviewError::Unavailable);
        }
        let mut d = self.0.lock().unwrap();
        let s = d
            .leases
            .iter()
            .find(|(_, p)| p.preview.id == *id && p.replica == Some(r) && live(&d, p))
            .map(|(s, _)| *s);
        if let Some(s) = s {
            d.leases.get_mut(&s).unwrap().preview.status = status;
            return Ok(true);
        }
        Ok(false)
    }
    async fn stop(&self, s: AgentSessionId) -> Result<Option<StoredPreview>, PreviewError> {
        let mut d = self.0.lock().unwrap();
        Ok(d.leases.get_mut(&s).map(|p| {
            p.preview.status = PreviewStatus::Stopped;
            p.clone()
        }))
    }
    async fn credential(
        &self,
        k: CredentialKind,
        c: StoredCredential,
        limit: i64,
    ) -> Result<(), PreviewError> {
        let mut d = self.0.lock().unwrap();
        if !d.leases.values().any(|p| {
            p.preview.id == c.preview && p.preview.status == PreviewStatus::Ready && live(&d, p)
        }) {
            return Err(PreviewError::Offline);
        }
        if d.credentials
            .values()
            .filter(|(kind, c)| kind == k.as_str() && c.expires > now())
            .count()
            >= limit as usize
        {
            return Err(PreviewError::Limited);
        }
        d.credentials.insert(c.hash, (k.as_str().into(), c));
        Ok(())
    }
    async fn authenticate(
        &self,
        k: CredentialKind,
        id: &PreviewId,
        hash: [u8; 32],
        consume: bool,
    ) -> Result<StoredCredential, PreviewError> {
        let mut d = self.0.lock().unwrap();
        let (kind, c) = d.credentials.get(&hash).ok_or(PreviewError::Denied)?;
        if kind != k.as_str() || c.preview != *id || c.expires <= now() {
            return Err(PreviewError::Denied);
        }
        let c = c.clone();
        if consume {
            d.credentials.remove(&hash);
        }
        Ok(c)
    }
    async fn heartbeat(
        &self,
        r: Uuid,
        address: SocketAddr,
        ttl_seconds: f64,
    ) -> Result<Vec<Preview>, PreviewError> {
        let mut transitions = Vec::new();
        let mut d = self.0.lock().unwrap();
        if d.replicas.get(&r).is_some_and(|(_, e)| *e <= now()) {
            for p in d.leases.values_mut().filter(|p| {
                p.replica == Some(r)
                    && matches!(
                        p.preview.status,
                        PreviewStatus::Starting | PreviewStatus::Ready
                    )
            }) {
                p.preview.status = PreviewStatus::Offline;
                transitions.push(p.preview.clone());
            }
        }
        d.replicas
            .entry(r)
            .and_modify(|(_, e)| *e = now() + (ttl_seconds * 1000.0) as i64)
            .or_insert((address, now() + (ttl_seconds * 1000.0) as i64));
        Ok(transitions)
    }
    async fn destination(&self, id: &PreviewId) -> Result<(Uuid, SocketAddr), PreviewError> {
        let d = self.0.lock().unwrap();
        let p = d
            .leases
            .values()
            .find(|p| p.preview.id == *id && live(&d, p))
            .ok_or(PreviewError::Offline)?;
        let r = p.replica.ok_or(PreviewError::Offline)?;
        Ok((r, d.replicas.get(&r).ok_or(PreviewError::Offline)?.0))
    }
    async fn watch(
        &self,
        _: AgentSessionId,
        _: &MacroUserIdStr<'_>,
        _: WatchLimits,
    ) -> Result<(), PreviewError> {
        Ok(())
    }
    async fn watchers(
        &self,
        _: AgentSessionId,
        _: i64,
    ) -> Result<Vec<MacroUserIdStr<'static>>, PreviewError> {
        Ok(vec![])
    }
    async fn sweep(&self) -> Result<Vec<Preview>, PreviewError> {
        let mut d = self.0.lock().unwrap();
        let ids: Vec<_> = d
            .leases
            .iter()
            .filter(|(_, p)| {
                p.replica.is_some()
                    && !live(&d, p)
                    && matches!(
                        p.preview.status,
                        PreviewStatus::Starting | PreviewStatus::Ready
                    )
            })
            .map(|(s, _)| *s)
            .collect();
        Ok(ids
            .into_iter()
            .map(|s| {
                let p = d.leases.get_mut(&s).unwrap();
                p.preview.status = PreviewStatus::Offline;
                p.preview.clone()
            })
            .collect())
    }
}
