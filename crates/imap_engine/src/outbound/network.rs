//! Public-egress resolution, IP pinning, TLS identity and bounded transport reads.
mod circuit;
use crate::domain::models::{Endpoint, Error};
use std::{
    collections::BTreeMap,
    fmt, io,
    net::{IpAddr, SocketAddr},
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::TcpStream,
    time::{Duration, timeout},
};
use tokio_rustls::{
    TlsConnector,
    rustls::{ClientConfig, RootCertStore, pki_types::ServerName},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_LITERAL: usize = 25 * 1024 * 1024;
const MAX_LINE: usize = 32 * 1024 * 1024;

/// A local-only endpoint override, injected by the composition root, never an API caller.
#[derive(Clone, Default)]
pub struct LocalEndpoints {
    /// Exact hostname:port to dial-address mappings.
    pub addresses: BTreeMap<String, String>,
    /// Private lab trust root in PEM format.
    pub trust_root_pem: Option<String>,
}

/// Pinned connector. Production construction does not accept any bypass.
#[derive(Clone)]
pub struct Connector {
    tls: Arc<ClientConfig>,
    local: LocalEndpoints,
    hosts: Arc<Mutex<BTreeMap<String, Arc<tokio::sync::Semaphore>>>>,
    health: circuit::Health,
}
impl Connector {
    /// Build with system public trust plus an explicitly local test CA.
    pub fn new(local: LocalEndpoints) -> Result<Self, Error> {
        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        if let Some(pem) = &local.trust_root_pem {
            for cert in rustls_pemfile::certs(&mut pem.as_bytes()) {
                roots
                    .add(cert.map_err(|_| Error::Invalid)?)
                    .map_err(|_| Error::Invalid)?;
            }
        }
        let tls = ClientConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| Error::Invalid)?
        .with_root_certificates(roots)
        .with_no_client_auth();
        Ok(Self {
            tls: Arc::new(tls),
            local,
            hosts: Arc::new(Mutex::new(BTreeMap::new())),
            health: Default::default(),
        })
    }
    /// Validate endpoint syntax and standard protocol ports before resolving.
    pub fn validate(e: &Endpoint, imap: bool) -> Result<(), Error> {
        let allowed = if imap {
            matches!(
                (e.port, e.tls),
                (993, crate::domain::models::TlsMode::Implicit)
                    | (143, crate::domain::models::TlsMode::StartTls)
            )
        } else {
            matches!(
                (e.port, e.tls),
                (465, crate::domain::models::TlsMode::Implicit)
                    | (587, crate::domain::models::TlsMode::StartTls)
            )
        };
        if !allowed
            || e.host.len() > 253
            || !e.host.contains('.')
            || e.host.parse::<IpAddr>().is_ok()
            || e.host
                .bytes()
                .any(|c| !c.is_ascii_alphanumeric() && !matches!(c, b'.' | b'-'))
            || e.host.split('.').any(|label| {
                label.is_empty()
                    || label.len() > 63
                    || label.starts_with('-')
                    || label.ends_with('-')
            })
            || e.username.is_empty()
            || e.username.len() > 1024
            || e.username.chars().any(char::is_control)
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
    /// Resolve once and connect to that checked numeric address; TLS still checks the hostname.
    pub async fn tcp(&self, e: &Endpoint) -> Result<Stream, Error> {
        let semaphore = {
            let mut hosts = self
                .hosts
                .lock()
                .map_err(|_| Error::ConnectionUnavailable)?;
            hosts.retain(|_, semaphore| Arc::strong_count(semaphore) > 1);
            if hosts.len() >= 4096 && !hosts.contains_key(&e.host.to_ascii_lowercase()) {
                return Err(Error::Throttled);
            }
            hosts
                .entry(e.host.to_ascii_lowercase())
                .or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(200)))
                .clone()
        };
        let permit = semaphore
            .try_acquire_owned()
            .map_err(|_| Error::Throttled)?;
        let key = format!("{}:{}", e.host.to_ascii_lowercase(), e.port);
        let attempt = self.health.admit(key.clone())?;
        let addresses = if let Some(address) = self.local.addresses.get(&key) {
            timeout(CONNECT_TIMEOUT, tokio::net::lookup_host(address.as_str()))
                .await
                .map_err(|_| Error::ConnectionUnavailable)?
                .map_err(|_| Error::ConnectionUnavailable)?
                .collect::<Vec<SocketAddr>>()
        } else {
            let values = timeout(
                CONNECT_TIMEOUT,
                tokio::net::lookup_host((e.host.as_str(), e.port)),
            )
            .await
            .map_err(|_| Error::ConnectionUnavailable)?
            .map_err(|_| Error::ConnectionUnavailable)?
            .collect::<Vec<_>>();
            // Reject the whole mixed answer rather than allowing an internal-address side channel.
            if values.is_empty()
                || values.len() > 16
                || values.iter().any(|a| egress_guard::is_blocked_ip(a.ip()))
            {
                attempt.ignore();
                return Err(Error::Forbidden);
            }
            values
        };
        for address in addresses {
            if let Ok(Ok(socket)) = timeout(CONNECT_TIMEOUT, TcpStream::connect(address)).await {
                socket
                    .set_nodelay(true)
                    .map_err(|_| Error::ConnectionUnavailable)?;
                return Ok(Stream::plain(socket, permit, attempt));
            }
        }
        Err(Error::ConnectionUnavailable)
    }
    /// Upgrade only the checked connection, using the original hostname for SNI/certificate verification.
    pub async fn tls(&self, e: &Endpoint, socket: Stream) -> Result<Stream, Error> {
        let Stream {
            inner,
            permit,
            attempt,
            ..
        } = socket;
        let name = ServerName::try_from(e.host.clone()).map_err(|_| Error::Invalid)?;
        let stream = timeout(
            CONNECT_TIMEOUT,
            TlsConnector::from(self.tls.clone()).connect(name, inner),
        )
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
        .map_err(|_| Error::ConnectionUnavailable)?;
        if let Some(attempt) = attempt {
            attempt.success();
        }
        Ok(Stream {
            inner: Box::new(stream),
            attempt: None,
            permit,
            line: Vec::new(),
            literal: 0,
            total: 0,
        })
    }
}

trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}
/// Redacted transport with a literal-length guard before async-imap can reserve its buffer.
pub struct Stream {
    inner: Box<dyn Io>,
    permit: Option<tokio::sync::OwnedSemaphorePermit>,
    attempt: Option<circuit::Attempt>,
    line: Vec<u8>,
    literal: usize,
    total: usize,
}
impl Stream {
    /// Wrap a pre-TLS stream with the same line and literal limits.
    fn plain(
        socket: TcpStream,
        permit: tokio::sync::OwnedSemaphorePermit,
        attempt: circuit::Attempt,
    ) -> Self {
        Self {
            inner: Box::new(socket),
            permit: Some(permit),
            attempt: Some(attempt),
            line: Vec::new(),
            literal: 0,
            total: 0,
        }
    }
}
impl fmt::Debug for Stream {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("MailStream([REDACTED])")
    }
}
impl AsyncRead for Stream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        match Pin::new(&mut self.inner).poll_read(cx, buf) {
            Poll::Ready(Ok(())) => {
                let bytes = &buf.filled()[before..];
                self.total = self.total.saturating_add(bytes.len());
                if self.total > 512 * 1024 * 1024 {
                    return Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "mail response limit",
                    )));
                }
                for byte in bytes {
                    if self.literal > 0 {
                        self.literal -= 1;
                        continue;
                    }
                    self.line.push(*byte);
                    if self.line.len() > MAX_LINE {
                        return Poll::Ready(Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "mail line limit",
                        )));
                    }
                    if self.line.ends_with(b"\r\n") {
                        if let Some(start) = self.line.iter().rposition(|b| *b == b'{') {
                            let tail = &self.line[start..];
                            use nom::{
                                IResult, Parser, bytes::complete::tag, character::complete::digit1,
                                combinator::map_res, sequence::delimited,
                            };
                            let parsed: IResult<&[u8], usize> = delimited(
                                tag(&b"{"[..]),
                                map_res(digit1, |v: &[u8]| {
                                    std::str::from_utf8(v)
                                        .ok()
                                        .and_then(|s| s.parse::<usize>().ok())
                                        .ok_or(())
                                }),
                                tag(&b"}\r\n"[..]),
                            )
                            .parse(tail);
                            if let Ok((rest, n)) = parsed
                                && rest.is_empty()
                            {
                                if n > MAX_LITERAL {
                                    return Poll::Ready(Err(io::Error::new(
                                        io::ErrorKind::InvalidData,
                                        "mail literal limit",
                                    )));
                                }
                                self.literal = n;
                            }
                        }
                        self.line.clear();
                    }
                }
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}
impl AsyncWrite for Stream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        b: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, b)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
