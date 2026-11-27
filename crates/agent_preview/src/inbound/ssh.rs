use crate::domain::{Lease, PreviewService, PreviewStatus, ports::Tunnel};
use russh::server::{Auth, Config, Handler, Session};
use std::{
    pin::Pin,
    sync::{Arc, Mutex, OnceLock},
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::TcpListener,
    sync::Semaphore,
};
use tokio_util::sync::CancellationToken;

/// RFC 4253 bounds the identification line, CR LF included.
const MAX_IDENTIFICATION: usize = 255;
const MAX_CLIENT_SOFTWARE: usize = 64;

/// Composition-root factory for the outbound tunnel capability.
pub type TunnelFactory = Arc<dyn Fn(russh::server::Handle) -> Arc<dyn Tunnel> + Send + Sync>;
/// Load the persistent server host key. The client never needs a private key.
pub fn host_key(pem: &str) -> Result<russh::keys::PrivateKey, rootcause::Report> {
    Ok(russh::keys::PrivateKey::from_openssh(pem).map_err(|e| rootcause::report!(e))?)
}
/// Public key material embedded in each generated known_hosts file.
pub fn public_key(key: &russh::keys::PrivateKey) -> Result<String, rootcause::Report> {
    Ok(key
        .public_key()
        .to_openssh()
        .map_err(|e| rootcause::report!(e))?
        .split_whitespace()
        .take(2)
        .collect::<Vec<_>>()
        .join(" "))
}
/// Serve bounded SSH transports; no shells, exec, direct forwarding, or real remote listeners.
pub async fn serve(
    listener: TcpListener,
    key: russh::keys::PrivateKey,
    service: PreviewService,
    factory: TunnelFactory,
    shutdown: CancellationToken,
) -> Result<(), rootcause::Report> {
    let config = Arc::new(Config {
        keys: vec![key],
        max_auth_attempts: 1,
        auth_rejection_time: Duration::from_secs(1),
        auth_rejection_time_initial: Some(Duration::from_secs(1)),
        inactivity_timeout: Some(Duration::from_secs(90)),
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 2,
        maximum_packet_size: 32 * 1024,
        window_size: 256 * 1024,
        channel_buffer_size: 8,
        event_buffer_size: 32,
        ..Config::default()
    });
    let capacity = Arc::new(Semaphore::new(1024));
    loop {
        let (socket, _) = tokio::select! {
            _ = shutdown.cancelled() => return Ok(()),
            connection = listener.accept() => connection.map_err(|e| rootcause::report!(e))?,
        };
        let Ok(permit) = capacity.clone().try_acquire_owned() else {
            continue;
        };
        let config = config.clone();
        let service = service.clone();
        let factory = factory.clone();
        let shutdown = shutdown.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let lease = Arc::new(Mutex::new(None));
            let authenticated = CancellationToken::new();
            let client = Arc::new(OnceLock::new());
            let handler = Connection {
                service: service.clone(),
                factory,
                lease: lease.clone(),
                authenticated: authenticated.clone(),
                client: client.clone(),
            };
            let socket = Identified {
                stream: socket,
                line: Vec::new(),
                client,
            };
            let running = tokio::time::timeout(
                Duration::from_secs(10),
                russh::server::run_stream(config, socket, handler),
            )
            .await;
            if let Ok(Ok(mut running)) = running {
                let handle = running.handle();
                // The run_stream future only waits for the SSH identification, not authentication.
                let authenticated_in_time = tokio::select! {
                    _ = shutdown.cancelled() => false,
                    _ = &mut running => false,
                    result = tokio::time::timeout(Duration::from_secs(15), authenticated.cancelled()) => result.is_ok(),
                };
                if authenticated_in_time {
                    let connected = lease.lock().expect("connection mutex").clone();
                    if let Some(connected) = connected {
                        // Cancellation also closes authenticated transports which
                        // have not registered a forward yet (no Tunnel handle exists).
                        tokio::select! {
                            _ = shutdown.cancelled() => {},
                            _ = connected.cancel.cancelled() => {},
                            _ = &mut running => {},
                        }
                    }
                }
                let _ = handle
                    .disconnect(
                        russh::Disconnect::ByApplication,
                        "connection ended".into(),
                        "en".into(),
                    )
                    .await;
            }
            let connected = lease.lock().expect("connection mutex").clone();
            if let Some(lease) = connected {
                service.finish(&lease, PreviewStatus::Offline).await;
            }
        });
    }
}
struct Connection {
    service: PreviewService,
    factory: TunnelFactory,
    lease: Arc<Mutex<Option<Arc<Lease>>>>,
    authenticated: CancellationToken,
    client: Arc<OnceLock<String>>,
}
impl Handler for Connection {
    type Error = russh::Error;
    async fn auth_none(&mut self, user: &str) -> Result<Auth, Self::Error> {
        if user.len() > 128 {
            return Ok(Auth::reject());
        }
        let client = self.client.get().map_or("unknown", String::as_str);
        match self.service.authenticate_ssh(user, client).await {
            Ok(Some(lease)) => {
                *self.lease.lock().expect("connection mutex") = Some(lease);
                self.authenticated.cancel();
                Ok(Auth::Accept)
            }
            Ok(None) | Err(_) => Ok(Auth::reject()),
        }
    }
    async fn tcpip_forward(
        &mut self,
        address: &str,
        port: &mut u32,
        session: &mut Session,
    ) -> Result<bool, Self::Error> {
        let lease = self.lease.lock().expect("connection mutex").clone();
        let Some(lease) = lease else {
            return Ok(false);
        };
        if self
            .service
            .register(&lease, address, *port, (self.factory)(session.handle()))
            .is_err()
        {
            return Ok(false);
        }
        let service = self.service.clone();
        tokio::spawn(async move {
            // Yield until the SSH success response has reached the client's forward table.
            tokio::time::sleep(Duration::from_millis(100)).await;
            for _ in 0..60 {
                if !lease.live() {
                    return;
                }
                if super::http::probe(&lease).await.is_ok() {
                    service.ready(&lease).await;
                    return;
                }
                tokio::select! { _ = lease.cancel.cancelled() => return, _ = tokio::time::sleep(Duration::from_secs(1)) => {} }
            }
            service.finish(&lease, PreviewStatus::Offline).await;
        });
        Ok(true)
    }
    async fn cancel_tcpip_forward(
        &mut self,
        address: &str,
        port: u32,
        _: &mut Session,
    ) -> Result<bool, Self::Error> {
        if address != "127.0.0.1" || port != 1 {
            return Ok(false);
        }
        let lease = self.lease.lock().expect("connection mutex").clone();
        if let Some(lease) = lease {
            self.service.finish(&lease, PreviewStatus::Stopped).await;
        }
        Ok(true)
    }
}

/// Copies the client's identification line (`SSH-2.0-OpenSSH_9.6 ...`) as russh
/// reads it. russh does not expose it before authentication, and it is the one
/// non-identifying signal that tells our script's OpenSSH from other clients.
struct Identified<S> {
    stream: S,
    line: Vec<u8>,
    client: Arc<OnceLock<String>>,
}
impl<S: AsyncRead + Unpin> AsyncRead for Identified<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let start = buf.filled().len();
        let result = Pin::new(&mut self.stream).poll_read(cx, buf);
        if self.client.get().is_none() {
            for &byte in &buf.filled()[start..] {
                if byte == b'\n' || self.line.len() >= MAX_IDENTIFICATION {
                    let line = std::mem::take(&mut self.line);
                    let _ = self.client.set(client_software(&line));
                    break;
                }
                self.line.push(byte);
            }
        }
        result
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for Identified<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

/// The software field of `SSH-protoversion-softwareversion [comments]`, without
/// comments, which may name a host. Bounded and printable-only for telemetry.
fn client_software(line: &[u8]) -> String {
    let line = String::from_utf8_lossy(line);
    let software = line
        .strip_prefix("SSH-")
        .and_then(|rest| rest.split_once('-'))
        .map(|(_, software)| software.split([' ', '\r']).next().unwrap_or_default())
        .unwrap_or_default();
    let software: String = software
        .chars()
        .filter(char::is_ascii_graphic)
        .take(MAX_CLIENT_SOFTWARE)
        .collect();
    if software.is_empty() {
        "unknown".to_owned()
    } else {
        software
    }
}

#[cfg(test)]
mod test;
