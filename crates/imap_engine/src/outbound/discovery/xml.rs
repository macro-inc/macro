//! Parse Mozilla ISPDB, Exchange POX, and SOAP advertisements with the same TLS policy.
use crate::domain::{
    discovery::{manual, valid_host},
    models::{Discovery, Endpoint, TlsMode},
};
use macro_user_id::{
    cowlike::ArcCowStr,
    email::{Email, ReadEmailParts},
};
use quick_xml::{Reader, events::Event};
use std::collections::BTreeMap;

#[derive(Default)]
struct Server {
    protocol: String,
    values: BTreeMap<String, String>,
}

impl Server {
    fn endpoint(&self, email: &Email<ArcCowStr<'_>>) -> Option<(bool, Endpoint)> {
        let get = |names: &[&str]| {
            names
                .iter()
                .find_map(|name| self.values.get(*name).map(String::as_str))
        };
        let protocol = get(&["type"])
            .unwrap_or(&self.protocol)
            .to_ascii_lowercase();
        let imap = match protocol.as_str() {
            "imap" | "imap4" | "externalimap4connections" => true,
            "smtp" | "externalsmtpconnections" => false,
            _ => return None,
        };
        let port = get(&["port"])?.parse::<u16>().ok()?;
        let security = get(&["sockettype", "encryptionmethod", "encryption", "ssl", "tls"])?
            .to_ascii_lowercase();
        let tls = match (imap, port, security.as_str()) {
            (true, 993, "ssl" | "tls" | "on") | (false, 465, "ssl" | "tls" | "on") => {
                TlsMode::Implicit
            }
            (true, 143, "starttls" | "tls" | "on") | (false, 587, "starttls" | "tls" | "on") => {
                TlsMode::StartTls
            }
            _ => return None,
        };
        let local = email.local_part();
        let domain = email.domain_part();
        let host = get(&["hostname", "server"])?
            .replace("%EMAILDOMAIN%", domain)
            .to_ascii_lowercase();
        if !valid_host(&host) {
            return None;
        }
        let username = match get(&["username", "loginname"]).unwrap_or("%EMAILADDRESS%") {
            "%EMAILADDRESS%" => email.email_str(),
            "%EMAILLOCALPART%" => local,
            "%EMAILDOMAIN%" => domain,
            other if other.len() <= 254 && !other.chars().any(char::is_control) => other,
            _ => return None,
        };
        Some((
            imap,
            Endpoint {
                host,
                port,
                tls,
                username: username.into(),
            },
        ))
    }
}

/// Settings and an optional POX redirect. The network adapter validates every redirect.
pub(super) fn parse(
    data: &[u8],
    email: &Email<ArcCowStr<'_>>,
) -> Option<(Discovery, Option<String>)> {
    let mut xml = Reader::from_reader(data);
    xml.config_mut().trim_text(true);
    let mut stack = Vec::new();
    let mut current: Option<(usize, Server)> = None;
    let mut settings = manual();
    let mut soap_kind = String::new();
    let mut action = String::new();
    let mut redirect = None;
    loop {
        match xml.read_event().ok()? {
            Event::Start(e) => {
                if stack.len() >= 40 {
                    return None;
                }
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                stack.push(name.clone());
                if name == "usersetting" {
                    soap_kind.clear();
                }
                if matches!(
                    name.as_str(),
                    "incomingserver" | "outgoingserver" | "protocol" | "protocolconnection"
                ) {
                    let mut protocol = if name == "protocolconnection" {
                        soap_kind.clone()
                    } else {
                        String::new()
                    };
                    for attr in e.attributes() {
                        let attr = attr.ok()?;
                        if attr.key.as_ref().eq_ignore_ascii_case(b"type") {
                            protocol = String::from_utf8_lossy(&attr.value).into_owned();
                        }
                    }
                    current = Some((
                        stack.len(),
                        Server {
                            protocol,
                            ..Default::default()
                        },
                    ));
                }
            }
            Event::Text(e) => {
                let value = e.decode().ok()?;
                if value.len() > 2048 {
                    continue;
                }
                let key = stack.last()?;
                if let Some((depth, server)) = &mut current {
                    if stack.len() == *depth + 1 {
                        server
                            .values
                            .entry(key.clone())
                            .or_default()
                            .push_str(&value);
                    }
                } else if key == "name"
                    && stack
                        .iter()
                        .rev()
                        .nth(1)
                        .is_some_and(|p| p == "usersetting")
                {
                    soap_kind = value.to_lowercase();
                } else if key == "action" {
                    action = value.to_ascii_lowercase();
                } else if key == "redirecturl" {
                    redirect = Some(value.to_string());
                }
            }
            Event::End(_) => {
                if current
                    .as_ref()
                    .is_some_and(|(depth, _)| *depth == stack.len())
                    && let Some((_, server)) = current.take()
                    && let Some((imap, e)) = server.endpoint(email)
                {
                    let slot = if imap {
                        &mut settings.imap
                    } else {
                        &mut settings.smtp
                    };
                    // Prefer implicit TLS if a provider advertises several allowed configurations.
                    if slot.as_ref().is_none_or(|existing| {
                        existing.tls == TlsMode::StartTls && e.tls == TlsMode::Implicit
                    }) {
                        *slot = Some(e);
                    }
                }
                stack.pop()?;
            }
            Event::Eof => break,
            Event::DocType(_) => return None,
            _ => {}
        }
    }
    if !stack.is_empty() {
        return None;
    }
    Some((
        settings,
        if action == "redirecturl" {
            redirect
        } else {
            None
        },
    ))
}

#[cfg(test)]
mod test {
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
        let address =
            macro_user_id::email::EmailStr::parse_from_str("Owner+Tag@Example.com").unwrap();
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
}
