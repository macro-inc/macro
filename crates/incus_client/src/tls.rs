//! TLS for an Incus endpoint: present our client certificate and accept only
//! the one server certificate we pinned. Incus serves a self-signed
//! certificate, so name and chain checks do not apply; byte equality with the
//! pinned certificate is the trust decision, as in the upstream Incus client.

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::WebPkiSupportedAlgorithms;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{CertificateError, ClientConfig, DigitallySignedStruct, SignatureScheme};

use crate::IncusError;

pub(crate) fn client_config(
    client_cert_pem: &str,
    client_key_pem: &str,
    server_cert_pem: &str,
) -> Result<ClientConfig, IncusError> {
    let client_chain = CertificateDer::pem_slice_iter(client_cert_pem.as_bytes())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| IncusError::InvalidCredentials(format!("client certificate: {error}")))?;

    if client_chain.is_empty() {
        return Err(IncusError::InvalidCredentials(
            "client certificate PEM has no certificate".to_owned(),
        ));
    }

    let client_key = PrivateKeyDer::from_pem_slice(client_key_pem.as_bytes())
        .map_err(|error| IncusError::InvalidCredentials(format!("client key: {error}")))?;

    let pinned = CertificateDer::from_pem_slice(server_cert_pem.as_bytes())
        .map_err(|error| IncusError::InvalidCredentials(format!("server certificate: {error}")))?;

    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let verifier = PinnedServerCertificate {
        pinned,
        algorithms: provider.signature_verification_algorithms,
    };

    ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| IncusError::InvalidCredentials(format!("TLS versions: {error}")))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_client_auth_cert(client_chain, client_key)
        .map_err(|error| IncusError::InvalidCredentials(format!("client identity: {error}")))
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

#[cfg(test)]
mod test;
