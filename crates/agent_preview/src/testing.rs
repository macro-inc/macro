use crate::domain::{ports::*, *};
use async_trait::async_trait;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
pub const SESSION: &str = "00000000-0000-0000-0000-000000000001";
pub const USER: &str = "macro|viewer@example.com";
pub struct TestAuthority(pub AtomicBool);
#[async_trait]
impl Authority for TestAuthority {
    async fn agent(&self, token: &str) -> Result<AgentIdentity, PreviewError> {
        if token != "session-secret" {
            return Err(PreviewError::Denied);
        }
        Ok(identity())
    }
    async fn viewer(&self, _: &str, _: &str) -> Result<(), PreviewError> {
        self.active(SESSION).await
    }
    async fn active(&self, _: &str) -> Result<(), PreviewError> {
        if self.0.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(PreviewError::Denied)
        }
    }
}
pub struct TestEvents;
#[async_trait]
impl Events for TestEvents {
    async fn changed(&self, _: &Preview, _: &[String]) -> Result<(), PreviewError> {
        Ok(())
    }
}
pub fn identity() -> AgentIdentity {
    AgentIdentity {
        session: SESSION.into(),
        owner: USER.into(),
    }
}
pub fn receipt<T: RequiredPermission>(level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        macro_user_id::user_id::MacroUserIdStr::try_from(USER.to_owned()).unwrap(),
        Entity {
            entity_id: SESSION.into(),
            entity_type: EntityType::AgentSession,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .unwrap()
}
pub fn fixture(ssh_port: u16) -> (PreviewService, Arc<TestAuthority>, russh::keys::PrivateKey) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("host_key");
    assert!(
        std::process::Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "", "-f"])
            .arg(&path)
            .status()
            .unwrap()
            .success()
    );
    let key = crate::inbound::ssh::host_key(&std::fs::read_to_string(path).unwrap()).unwrap();
    let authority = Arc::new(TestAuthority(AtomicBool::new(true)));
    let service = PreviewService::new(
        Settings {
            domain: "preview.test".into(),
            https_port: 443,
            local_ssh_fallback: false,
            ssh_host: "localhost".into(),
            ssh_port,
            host_key: crate::inbound::ssh::public_key(&key).unwrap(),
            app_origin: "https://macro.test".into(),
        },
        authority.clone(),
        Arc::new(TestEvents),
    )
    .unwrap();
    (service, authority, key)
}
pub struct TcpTunnel(pub std::net::SocketAddr);
#[async_trait]
impl Tunnel for TcpTunnel {
    async fn open(&self) -> Result<Stream, PreviewError> {
        Ok(Box::new(
            tokio::net::TcpStream::connect(self.0)
                .await
                .map_err(|_| PreviewError::Unavailable)?,
        ))
    }
    async fn close(&self) {}
}
