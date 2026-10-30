//! Direct peer TCP transport; HTTP and upgrades stream without a command bus.
use crate::domain::{
    PreviewError,
    ports::{PeerConnector, Stream},
};
use async_trait::async_trait;
use std::{net::SocketAddr, time::Duration};
/// Connects only to endpoints resolved and validated by the domain registry.
pub struct TcpPeerConnector;
#[async_trait]
impl PeerConnector for TcpPeerConnector {
    #[tracing::instrument(skip_all, err)]
    async fn connect(&self, address: SocketAddr) -> Result<Stream, PreviewError> {
        let socket = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::net::TcpStream::connect(address),
        )
        .await
        .map_err(|_| PreviewError::Unavailable)?
        .map_err(|_| PreviewError::Unavailable)?;
        Ok(Box::new(socket))
    }
}

/// UDP connect selects a local interface without sending packets or reading ECS secrets.
/// Works for awsvpc tasks and local Docker networks without another deployment setting.
pub async fn address(database_url: &str, port: u16) -> Result<SocketAddr, rootcause::Report> {
    let database = url::Url::parse(database_url)?;
    let host = database
        .host_str()
        .ok_or_else(|| rootcause::report!("database host required"))?;
    let remote = tokio::net::lookup_host((host, database.port().unwrap_or(5432)))
        .await?
        .next()
        .ok_or_else(|| rootcause::report!("database address required"))?;
    let bind = if remote.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    let socket = tokio::net::UdpSocket::bind(bind).await?;
    socket.connect(remote).await?;
    Ok(SocketAddr::new(socket.local_addr()?.ip(), port))
}
