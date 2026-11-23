use super::*;

pub(crate) fn request(owner: &str, username: &str) -> VerifyRequest {
    let login = Login {
        endpoint: Endpoint {
            host: "mail.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: username.into(),
        },
        password: Secret("synthetic-password".into()),
    };
    VerifyRequest {
        user_id: owner.into(),
        email: "owner@example.net".to_owned().try_into().unwrap(),
        imap: login.clone(),
        smtp: login,
        confirmed_hosts: vec!["mail.example.net".into()],
    }
}

#[test]
fn stored_login_scope_cannot_be_reconstructed_from_a_username_dictionary() {
    let input = request("owner", "mailbox@example.net");
    let admitted = scopes(
        &input,
        &VerificationScopeKey::derive("synthetic-test-auth-key").unwrap(),
    )
    .unwrap();
    let reversible = format!(
        "{:x}",
        Sha256::digest("login:mail.example.net:mailbox@example.net")
    );
    assert!(!admitted.iter().any(|(scope, _)| scope == &reversible));
    let username_digest = format!("{:x}", Sha256::digest("mailbox@example.net"));
    assert!(
        !admitted
            .iter()
            .any(|(scope, _)| scope == &username_digest || scope.contains("mailbox@example.net"))
    );
}

#[test]
fn login_scope_is_stable_but_changes_with_key_or_purpose() {
    let first = VerificationScopeKey::derive("synthetic-first-auth-key").unwrap();
    let same = VerificationScopeKey::derive("synthetic-first-auth-key").unwrap();
    let rotated = VerificationScopeKey::derive("synthetic-rotated-auth-key").unwrap();
    let digest = first.login_scope("mail.example.net", "Mailbox").unwrap();
    assert_ne!(
        first.digest(b"imap-verification-owner:", b"same").unwrap(),
        first.digest(b"imap-verification-login:", b"same").unwrap()
    );
    assert_eq!(
        digest,
        same.login_scope("MAIL.EXAMPLE.NET", "Mailbox").unwrap()
    );
    assert_ne!(
        digest,
        rotated.login_scope("mail.example.net", "Mailbox").unwrap()
    );
    assert_ne!(
        digest,
        first.login_scope("mail.example.net", "mailbox").unwrap()
    );
    let mut different_purpose =
        Hmac::<Sha256>::new_from_slice(b"synthetic-first-auth-key").unwrap();
    different_purpose.update(b"macro/imap/different-purpose/v1");
    let other = VerificationScopeKey(Zeroizing::new(
        different_purpose.finalize().into_bytes().into(),
    ));
    assert_ne!(
        digest,
        other.login_scope("mail.example.net", "Mailbox").unwrap()
    );
}

#[test]
fn keyed_login_preserves_owner_host_and_shared_login_caps() {
    let key = VerificationScopeKey::derive("synthetic-test-auth-key").unwrap();
    let first = scopes(&request("first-owner", "mailbox@example.net"), &key).unwrap();
    let second = scopes(&request("second-owner", "mailbox@example.net"), &key).unwrap();
    let owner = key.owner_scope("first-owner").unwrap();
    let host = format!("{:x}", Sha256::digest("host:mail.example.net"));
    let login = key
        .login_scope("mail.example.net", "mailbox@example.net")
        .unwrap();
    assert_eq!(
        first.len(),
        3,
        "identical protocol endpoints share admission buckets"
    );
    assert!(first.contains(&(owner.clone(), 10)));
    assert!(!second.iter().any(|(scope, _)| scope == &owner));
    for admitted in [&first, &second] {
        assert!(admitted.contains(&(host.clone(), 1000)));
        assert!(admitted.contains(&(login.clone(), 10)));
    }
}

#[test]
fn an_empty_auth_key_cannot_initialize_verification_admission() {
    assert!(matches!(
        VerificationScopeKey::derive(" "),
        Err(Error::Invalid)
    ));
}

#[test]
fn stored_owner_scope_cannot_be_reconstructed_from_an_email_dictionary() {
    let input = request("macro|owner@example.net", "mailbox@example.net");
    let key = VerificationScopeKey::derive("synthetic-test-auth-key").unwrap();
    let admitted = scopes(&input, &key).unwrap();
    let reversible = format!("{:x}", Sha256::digest("owner:macro|owner@example.net"));
    assert!(!admitted.iter().any(|(scope, _)| scope == &reversible));
}
