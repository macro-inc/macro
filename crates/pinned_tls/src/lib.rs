#![deny(missing_docs)]

//! mTLS between the control plane and the Firecracker host agent, both of
//! which use self-signed certificates: each side presents its certificate and
//! trusts exactly the certificates it pinned. Name and chain checks do not
//! apply; byte equality with a pinned certificate is the trust decision.

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::WebPkiSupportedAlgorithms;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, DistinguishedName, ServerConfig,
    SignatureScheme,
};

#[cfg(test)]
mod test;

/// Why the credentials cannot make a TLS configuration.
#[derive(Debug, thiserror::Error)]
pub enum InvalidCredentials {
    /// Our own certificate chain does not parse.
    #[error("own certificate: {0}")]
    OwnCertificate(#[source] rustls::pki_types::pem::Error),
    /// Our own certificate PEM holds no certificate.
    #[error("own certificate PEM holds no certificate")]
    NoCertificate,
    /// Our private key does not parse.
    #[error("private key: {0}")]
    Key(#[source] rustls::pki_types::pem::Error),
    /// A pinned peer certificate does not parse.
    #[error("pinned certificate: {0}")]
    PinnedCertificate(#[source] rustls::pki_types::pem::Error),
    /// No peer certificate is pinned: nobody could connect.
    #[error("no peer certificate is pinned")]
    NothingPinned,
    /// rustls refused the configuration.
    #[error("TLS configuration: {0}")]
    Rustls(#[from] rustls::Error),
}

fn own_identity(
    chain_pem: &str,
    key_pem: &str,
) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>), InvalidCredentials> {
    let chain = CertificateDer::pem_slice_iter(chain_pem.as_bytes())
        .collect::<Result<Vec<_>, _>>()
        .map_err(InvalidCredentials::OwnCertificate)?;
    if chain.is_empty() {
        return Err(InvalidCredentials::NoCertificate);
    }
    let key = PrivateKeyDer::from_pem_slice(key_pem.as_bytes()).map_err(InvalidCredentials::Key)?;
    Ok((chain, key))
}

fn pinned(certificate_pem: &str) -> Result<CertificateDer<'static>, InvalidCredentials> {
    CertificateDer::from_pem_slice(certificate_pem.as_bytes())
        .map_err(InvalidCredentials::PinnedCertificate)
}

/// A client presenting `chain_pem` with `key_pem`, trusting only the server
/// certificate `server_certificate_pem`.
pub fn client_config(
    chain_pem: &str,
    key_pem: &str,
    server_certificate_pem: &str,
) -> Result<ClientConfig, InvalidCredentials> {
    let (chain, key) = own_identity(chain_pem, key_pem)?;
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let verifier = PinnedServerCertificate {
        pinned: pinned(server_certificate_pem)?,
        algorithms: provider.signature_verification_algorithms,
    };
    Ok(ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_client_auth_cert(chain, key)?)
}

/// A server presenting `chain_pem` with `key_pem`, accepting only clients
/// that present one of `client_certificates_pem`. ALPN offers h2 and
/// HTTP/1.1.
pub fn server_config(
    chain_pem: &str,
    key_pem: &str,
    client_certificates_pem: &[String],
) -> Result<ServerConfig, InvalidCredentials> {
    let (chain, key) = own_identity(chain_pem, key_pem)?;
    let pinned = client_certificates_pem
        .iter()
        .map(|pem| pinned(pem))
        .collect::<Result<Vec<_>, _>>()?;
    if pinned.is_empty() {
        return Err(InvalidCredentials::NothingPinned);
    }
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let verifier = PinnedClientCertificates {
        pinned,
        algorithms: provider.signature_verification_algorithms,
    };
    let mut config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_client_cert_verifier(Arc::new(verifier))
        .with_single_cert(chain, key)?;
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Ok(config)
}

#[derive(Debug)]
struct PinnedServerCertificate {
    pinned: CertificateDer<'static>,
    algorithms: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for PinnedServerCertificate {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if end_entity.as_ref() == self.pinned.as_ref() {
            return Ok(ServerCertVerified::assertion());
        }
        Err(rustls::Error::InvalidCertificate(
            CertificateError::ApplicationVerificationFailure,
        ))
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, signature, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, signature, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

#[derive(Debug)]
struct PinnedClientCertificates {
    pinned: Vec<CertificateDer<'static>>,
    algorithms: WebPkiSupportedAlgorithms,
}

impl ClientCertVerifier for PinnedClientCertificates {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _now: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        if self
            .pinned
            .iter()
            .any(|pinned| pinned.as_ref() == end_entity.as_ref())
        {
            return Ok(ClientCertVerified::assertion());
        }
        Err(rustls::Error::InvalidCertificate(
            CertificateError::ApplicationVerificationFailure,
        ))
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, signature, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, signature, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}
