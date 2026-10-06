use std::sync::Arc;

use rustls::pki_types::{CertificateDer, pem::PemObject};
use tokio::net::TcpStream;
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

pub async fn connect_async(
    url: &str,
) -> anyhow::Result<(
    WebSocketStream<MaybeTlsStream<TcpStream>>,
    tokio_tungstenite::tungstenite::handshake::client::Response,
)> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(CertificateDer::from_pem_slice(include_bytes!(
        "../../../../../infra/local/certs/ca.pem"
    ))?)?;
    let config = rustls::ClientConfig::builder_with_provider(
        rustls::crypto::aws_lc_rs::default_provider().into(),
    )
    .with_safe_default_protocol_versions()?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(tokio_tungstenite::connect_async_tls_with_config(
        url,
        None,
        false,
        Some(Connector::Rustls(Arc::new(config))),
    )
    .await?)
}
