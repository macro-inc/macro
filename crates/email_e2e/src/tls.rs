//! An HTTPS address for the API.
//!
//! Microsoft Graph only notifies `https://` URLs, and the Outlook watch loop
//! only subscribes when the service's public address is one. This listener
//! terminates TLS with the repository's local development certificate and
//! passes the bytes on to the API's plain port, so Outlook change
//! notifications reach the service as they do in production.

use std::net::SocketAddr;
use std::sync::Arc;

use rootcause::prelude::*;
use rustls::ServerConfig;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// The local development certificate authority, which the Outlook emulator
/// is told to trust.
pub(crate) const AUTHORITY: &str = include_str!("../../../infra/local/certs/ca.pem");
/// A certificate of that authority for `localhost`. Not a secret: see
/// `infra/local/certs/README.md`.
const CERTIFICATE: &str = include_str!("../../../infra/local/certs/localhost.pem");
const KEY: &str = include_str!("../../../infra/local/certs/localhost-key.pem");

/// The running listener.
pub(crate) struct TlsFront {
    port: u16,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

impl TlsFront {
    /// Starts serving HTTPS for the plain HTTP server at `upstream`.
    pub(crate) async fn start(upstream: SocketAddr) -> Result<Self, Report> {
        let certificates = CertificateDer::pem_slice_iter(CERTIFICATE.as_bytes())
            .collect::<Result<Vec<_>, _>>()
            .context("the local development certificate is not valid PEM")?;
        let key = PrivateKeyDer::from_pem_slice(KEY.as_bytes())
            .context("the local development key is not valid PEM")?;
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let config = ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()?
            .with_no_client_auth()
            .with_single_cert(certificates, key)
            .context("the local development certificate and key do not match")?;
        let acceptor = TlsAcceptor::from(Arc::new(config));

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("could not bind the HTTPS listener")?;
        let port = listener.local_addr()?.port();

        let cancel = CancellationToken::new();
        let tracker = TaskTracker::new();
        tracker.spawn(accept(
            listener,
            acceptor,
            upstream,
            cancel.clone(),
            tracker.clone(),
        ));

        Ok(Self {
            port,
            cancel,
            tracker,
        })
    }

    /// The HTTPS base URL, on the name the certificate is for.
    pub(crate) fn url(&self) -> String {
        format!("https://localhost:{}", self.port)
    }

    /// Stops the listener and its connections.
    pub(crate) async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}

/// A listener dropped without `stop`, as when a stack fails to start, ends
/// too.
impl Drop for TlsFront {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

async fn accept(
    listener: TcpListener,
    acceptor: TlsAcceptor,
    upstream: SocketAddr,
    cancel: CancellationToken,
    tracker: TaskTracker,
) {
    loop {
        let accepted = tokio::select! {
            () = cancel.cancelled() => return,
            accepted = listener.accept() => accepted,
        };
        let Ok((stream, _)) = accepted else { continue };
        let acceptor = acceptor.clone();
        let cancel = cancel.clone();
        tracker.spawn(async move {
            tokio::select! {
                () = cancel.cancelled() => {}
                () = relay(stream, acceptor, upstream) => {}
            }
        });
    }
}

/// Carries one connection's bytes between the TLS client and the API.
async fn relay(stream: TcpStream, acceptor: TlsAcceptor, upstream: SocketAddr) {
    let Ok(mut client) = acceptor.accept(stream).await else {
        return;
    };
    let Ok(mut server) = TcpStream::connect(upstream).await else {
        return;
    };
    // Either side closing ends the connection; there is nothing to report.
    tokio::io::copy_bidirectional(&mut client, &mut server)
        .await
        .ok();
}
