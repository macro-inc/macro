use super::*;

const SERVER_CERT_PEM: &str = include_str!("../../testdata/server.crt");
const OTHER_CERT_PEM: &str = include_str!("../../testdata/other.crt");

#[test]
fn accepts_only_the_pinned_server_certificate() {
    let verifier = PinnedServerCertificate {
        pinned: CertificateDer::from_pem_slice(SERVER_CERT_PEM.as_bytes()).unwrap(),
        algorithms: rustls::crypto::aws_lc_rs::default_provider().signature_verification_algorithms,
    };
    let server_name = ServerName::try_from("10.200.0.2").unwrap();
    let server = CertificateDer::from_pem_slice(SERVER_CERT_PEM.as_bytes()).unwrap();
    let other = CertificateDer::from_pem_slice(OTHER_CERT_PEM.as_bytes()).unwrap();

    let pinned_result =
        verifier.verify_server_cert(&server, &[], &server_name, &[], UnixTime::now());
    let other_result = verifier.verify_server_cert(&other, &[], &server_name, &[], UnixTime::now());

    assert!(pinned_result.is_ok());
    assert!(matches!(
        other_result,
        Err(rustls::Error::InvalidCertificate(
            CertificateError::ApplicationVerificationFailure
        ))
    ));
}

#[test]
fn rejects_client_pem_without_certificate() {
    let result = client_config("", "", SERVER_CERT_PEM);

    assert!(matches!(result, Err(IncusError::InvalidCredentials(_))));
}
