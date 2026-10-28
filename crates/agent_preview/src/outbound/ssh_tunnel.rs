use crate::domain::{
    PreviewError,
    ports::{Stream, Tunnel},
};
use async_trait::async_trait;
/// SSH channel transport; the registered tuple is deliberately constant per connection.
pub struct SshTunnel(russh::server::Handle);
impl SshTunnel {
    /// Bind the capability to the authenticated SSH session.
    pub fn new(handle: russh::server::Handle) -> Self {
        Self(handle)
    }
}
#[async_trait]
impl Tunnel for SshTunnel {
    async fn open(&self) -> Result<Stream, PreviewError> {
        let channel = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.0
                .channel_open_forwarded_tcpip("127.0.0.1", 1, "127.0.0.1", 0),
        )
        .await
        .map_err(|_| PreviewError::Unavailable)?
        .map_err(|_| PreviewError::Offline)?;
        Ok(Box::new(channel.into_stream()))
    }
    async fn close(&self) {
        let _ = self
            .0
            .disconnect(
                russh::Disconnect::ByApplication,
                "preview ended".into(),
                "en".into(),
            )
            .await;
    }
}
