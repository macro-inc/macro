use super::*;

const SERVER_CERT_PEM: &str = include_str!("../testdata/server.crt");
const OTHER_CERT_PEM: &str = include_str!("../testdata/other.crt");

fn algorithms() -> WebPkiSupportedAlgorithms {
    rustls::crypto::aws_lc_rs::default_provider().signature_verification_algorithms
}

#[test]
fn a_client_accepts_only_the_pinned_server_certificate() {
    let verifier = PinnedServerCertificate {
        pinned: pinned(SERVER_CERT_PEM).unwrap(),
        algorithms: algorithms(),
    };
    let server_name = ServerName::try_from("10.200.0.2").unwrap();

    let pinned_result = verifier.verify_server_cert(
        &pinned(SERVER_CERT_PEM).unwrap(),
        &[],
        &server_name,
        &[],
        UnixTime::now(),
    );
    let other_result = verifier.verify_server_cert(
        &pinned(OTHER_CERT_PEM).unwrap(),
        &[],
        &server_name,
        &[],
        UnixTime::now(),
    );

    assert!(pinned_result.is_ok());
    assert!(matches!(
        other_result,
        Err(rustls::Error::InvalidCertificate(
            CertificateError::ApplicationVerificationFailure
        ))
    ));
}

#[test]
fn a_server_accepts_only_pinned_client_certificates() {
    let verifier = PinnedClientCertificates {
        pinned: vec![pinned(SERVER_CERT_PEM).unwrap()],
        algorithms: algorithms(),
    };

    assert!(
        verifier
            .verify_client_cert(&pinned(SERVER_CERT_PEM).unwrap(), &[], UnixTime::now())
            .is_ok()
    );
    assert!(
        verifier
            .verify_client_cert(&pinned(OTHER_CERT_PEM).unwrap(), &[], UnixTime::now())
            .is_err()
    );
}

#[test]
fn credentials_without_a_certificate_or_a_pin_are_refused() {
    assert!(matches!(
        client_config("", "", SERVER_CERT_PEM),
        Err(InvalidCredentials::NoCertificate)
    ));
    assert!(matches!(
        server_config(SERVER_CERT_PEM, "", &[]),
        Err(InvalidCredentials::Key(_))
    ));
}
