use super::*;
#[test]
fn tb_skips_cleartext_and_expands_separate_logins() {
    let data=br#"<clientConfig><emailProvider><incomingServer type="imap"><hostname>mail.example.com</hostname><port>143</port><socketType>plain</socketType></incomingServer><incomingServer type="imap"><hostname>imap.example.com</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILLOCALPART%</username></incomingServer><outgoingServer type="smtp"><hostname>%EMAILDOMAIN%</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer></emailProvider></clientConfig>"#;
    let (d, _) = parse(
        data,
        &macro_user_id::email::EmailStr::parse_from_str("u@example.com")
            .unwrap()
            .0,
    )
    .unwrap();
    assert_eq!(d.imap.unwrap().username, "u");
    let smtp = d.smtp.unwrap();
    assert_eq!(
        (smtp.host, smtp.tls),
        ("example.com".into(), TlsMode::StartTls)
    );
}
#[test]
fn soap_namespaces_and_pox_redirects() {
    let soap=br#"<a:UserSetting xmlns:a="urn:test"><a:Name>ExternalSmtpConnections</a:Name><a:ProtocolConnections><a:ProtocolConnection><a:Hostname>smtp.example.com</a:Hostname><a:Port>587</a:Port><a:EncryptionMethod>TLS</a:EncryptionMethod></a:ProtocolConnection></a:ProtocolConnections></a:UserSetting>"#;
    assert!(
        parse(
            soap,
            &macro_user_id::email::EmailStr::parse_from_str("u@example.com")
                .unwrap()
                .0
        )
        .unwrap()
        .0
        .smtp
        .is_some()
    );
    let pox=b"<Account><Action>redirectUrl</Action><RedirectUrl>https://another.example/autodiscover</RedirectUrl></Account>";
    assert!(
        parse(
            pox,
            &macro_user_id::email::EmailStr::parse_from_str("u@example.com")
                .unwrap()
                .0
        )
        .unwrap()
        .1
        .is_some()
    );
}

#[test]
fn advertised_username_templates_preserve_case_and_plus_suffixes() {
    let address = macro_user_id::email::EmailStr::parse_from_str("Owner+Tag@Example.com").unwrap();
    let data = br#"<clientConfig>
      <emailProvider>
        <incomingServer type="imap">
          <hostname>imap.example.com</hostname><port>993</port><socketType>SSL</socketType>
          <username>%EMAILLOCALPART%</username>
        </incomingServer>
        <outgoingServer type="smtp">
          <hostname>%EMAILDOMAIN%</hostname><port>587</port><socketType>STARTTLS</socketType>
          <username>%EMAILADDRESS%</username>
        </outgoingServer>
      </emailProvider>
    </clientConfig>"#;
    let (settings, _) = parse(data, &address.0).unwrap();
    assert_eq!(settings.imap.unwrap().username, "Owner+Tag");
    let smtp = settings.smtp.unwrap();
    assert_eq!(smtp.username, "Owner+Tag@Example.com");
    assert_eq!(smtp.host, "example.com");
}
