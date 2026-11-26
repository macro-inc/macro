//! Anonymous DNS and HTTPS discovery. Every HTTPS hop gets an independently
//! validated, pinned socket address and TLS verification for the original name.
mod xml;
use crate::domain::{
    discovery::{self, DiscoveryProvider},
    models::{Discovery, Endpoint, Error, TlsMode},
};
use async_trait::async_trait;
use futures::{
    FutureExt,
    stream::{FuturesUnordered, StreamExt},
};
use hickory_resolver::{TokioResolver, proto::rr::RData};
use macro_service_urls::ThunderbirdAutoconfigUrl;
use macro_user_id::{
    cowlike::ArcCowStr,
    email::{Email, ReadEmailParts},
};
use reqwest::{Client, Url, redirect};
use std::{sync::OnceLock, time::Duration};
use tokio::time::timeout;

const BUDGET: Duration = Duration::from_secs(5);
const BODY_LIMIT: usize = 256 * 1024;
const REDIRECT_LIMIT: usize = 3;

/// Public resolver with a pinned HTTP client for each destination.
pub struct MailDiscovery {
    ispdb: ThunderbirdAutoconfigUrl,
    resolver: OnceLock<TokioResolver>,
    remote_slots: tokio::sync::Semaphore,
}

impl MailDiscovery {
    /// Use the deployment's configured Thunderbird provider directory.
    pub fn new(ispdb: ThunderbirdAutoconfigUrl) -> Self {
        Self {
            ispdb,
            resolver: OnceLock::new(),
            remote_slots: tokio::sync::Semaphore::new(32),
        }
    }

    fn dns(&self) -> Option<&TokioResolver> {
        if self.resolver.get().is_none() {
            let resolver = TokioResolver::builder_tokio().ok()?.build().ok()?;
            let _ = self.resolver.set(resolver);
        }
        self.resolver.get()
    }

    async fn mx(&self, email: &Email<ArcCowStr<'_>>, domain: &str) -> Option<Discovery> {
        let answer = self.dns()?.mx_lookup(format!("{domain}.")).await.ok()?;
        let mx = answer
            .answers()
            .iter()
            .filter_map(|r| {
                if let RData::MX(mx) = &r.data {
                    Some(mx)
                } else {
                    None
                }
            })
            .min_by_key(|mx| mx.preference)?;
        discovery::from_mx(email, &mx.exchange.to_ascii()).ok()?
    }

    async fn srv(&self, domain: &str, record: &str, port: u16) -> Option<String> {
        let answer = self
            .dns()?
            .srv_lookup(format!("{record}._tcp.{domain}."))
            .await
            .ok()?;
        answer
            .answers()
            .iter()
            .filter_map(|r| {
                if let RData::SRV(srv) = &r.data {
                    Some(srv)
                } else {
                    None
                }
            })
            .filter(|r| r.port == port)
            .min_by_key(|r| (r.priority, std::cmp::Reverse(r.weight)))
            .map(|r| {
                r.target
                    .to_ascii()
                    .trim_end_matches('.')
                    .to_ascii_lowercase()
            })
            .filter(|host| discovery::valid_host(host))
    }

    async fn srv_settings(&self, email: &Email<ArcCowStr<'_>>, domain: &str) -> Option<Discovery> {
        let (imap, submission, upgrade) = tokio::join!(
            self.srv(domain, "_imaps", 993),
            self.srv(domain, "_submissions", 465),
            self.srv(domain, "_submission", 587)
        );
        let endpoint = |host, port, tls| Endpoint {
            host,
            port,
            tls,
            username: email.email_str().into(),
        };
        let d = Discovery {
            imap: imap.map(|host| endpoint(host, 993, TlsMode::Implicit)),
            smtp: submission
                .map(|host| endpoint(host, 465, TlsMode::Implicit))
                .or_else(|| upgrade.map(|host| endpoint(host, 587, TlsMode::StartTls))),
            ..discovery::manual()
        };
        usable(d)
    }

    async fn autodiscover(&self, email: &Email<ArcCowStr<'_>>, domain: &str) -> Option<Discovery> {
        let host = self
            .srv(domain, "_autodiscover", 443)
            .await
            .unwrap_or_else(|| format!("autodiscover.{domain}"));
        // Only this explicit flow includes a mailbox identifier. Its requests contain no credentials.
        let mail = quick_xml::escape::escape(email.email_str());
        let pox = format!(
            r#"<?xml version="1.0"?><Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006"><Request><EMailAddress>{mail}</EMailAddress><AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema></Request></Autodiscover>"#
        );
        let soap = format!(
            r#"<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a="http://schemas.microsoft.com/exchange/2010/Autodiscover" xmlns:wsa="http://www.w3.org/2005/08/addressing"><soap:Header><a:RequestedServerVersion>Exchange2013</a:RequestedServerVersion><wsa:Action>http://schemas.microsoft.com/exchange/2010/Autodiscover/Autodiscover/GetUserSettings</wsa:Action></soap:Header><soap:Body><a:GetUserSettingsRequestMessage><a:Request><a:Users><a:User><a:Mailbox>{mail}</a:Mailbox></a:User></a:Users><a:RequestedSettings><a:Setting>ExternalImap4Connections</a:Setting><a:Setting>ExternalSmtpConnections</a:Setting></a:RequestedSettings></a:Request></a:GetUserSettingsRequestMessage></soap:Body></soap:Envelope>"#
        );
        let request = format!("https://{host}/autodiscover/autodiscover");
        let mut pending = FuturesUnordered::new();
        pending.push(document(format!("{request}.xml"), email, Some(pox)));
        pending.push(document(format!("{request}.svc"), email, Some(soap)));
        while let Some(answer) = pending.next().await {
            if answer.is_some() {
                return answer;
            }
        }
        None
    }
}

fn usable(d: Discovery) -> Option<Discovery> {
    (d.imap.is_some() || d.smtp.is_some()).then_some(d)
}

fn valid_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(discovery::valid_host)
}

async fn pinned_client(url: &Url) -> Option<Client> {
    if !valid_url(url) {
        return None;
    }
    let host = url.host_str()?;
    let addresses = tokio::net::lookup_host((host, 443))
        .await
        .ok()?
        .collect::<Vec<_>>();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|a| egress_guard::is_blocked_ip(a.ip()))
    {
        return None;
    }
    Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(redirect::Policy::none())
        .timeout(BUDGET)
        .resolve_to_addrs(host, &addresses)
        .build()
        .ok()
}

/// Each redirect or Autodiscover POX redirect is checked again before creating the socket.
async fn document(
    start: String,
    email: &Email<ArcCowStr<'_>>,
    body: Option<String>,
) -> Option<Discovery> {
    let mut url = Url::parse(&start).ok()?;
    for _ in 0..=REDIRECT_LIMIT {
        let client = pinned_client(&url).await?;
        let request = match body.as_deref() {
            None => client.get(url.clone()),
            Some(payload) => client
                .post(url.clone())
                .header("Content-Type", "text/xml; charset=utf-8")
                .body(payload.to_owned()),
        };
        let mut reply = request.send().await.ok()?;
        if reply.status().is_redirection() {
            let target = url
                .join(
                    reply
                        .headers()
                        .get(reqwest::header::LOCATION)?
                        .to_str()
                        .ok()?,
                )
                .ok()?;
            // A cross-origin redirect must not forward the submitted mailbox identity.
            if body.is_some() && target.origin() != url.origin() {
                return None;
            }
            url = target;
            continue;
        }
        if !reply.status().is_success()
            || reply
                .content_length()
                .is_some_and(|n| n > BODY_LIMIT as u64)
        {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = reply.chunk().await.ok()? {
            if chunk.len() > BODY_LIMIT.saturating_sub(bytes.len()) {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        let (d, redirect) = xml::parse(&bytes, email)?;
        if let Some(hit) = usable(d) {
            return Some(hit);
        }
        let target = url.join(&redirect?).ok()?;
        if body.is_some() && target.origin() != url.origin() {
            return None;
        }
        url = target;
    }
    None
}

#[async_trait]
impl DiscoveryProvider for MailDiscovery {
    async fn discover(&self, email: &Email<ArcCowStr<'_>>) -> Result<Discovery, Error> {
        let direct = discovery::discover(email)?;
        if direct.provider.is_some() {
            return Ok(direct);
        }
        let domain = discovery::address_domain(email)?;
        // Reserved lab domains have manual or injected test endpoints and no public directory entry.
        if discovery::is_reserved_domain(&domain) {
            return Ok(direct);
        }
        let Ok(_slot) = self.remote_slots.try_acquire() else {
            return Ok(direct);
        };
        if let Ok(Some(d)) = timeout(BUDGET, self.mx(email, &domain)).await {
            return Ok(d);
        }
        let lookups = async {
            let mut urls = vec![
                format!("https://{domain}/.well-known/autoconfig/mail/config-v1.1.xml"),
                format!("https://autoconfig.{domain}/mail/config-v1.1.xml"),
            ];
            if let Ok(url) = Url::parse(self.ispdb.as_ref())
                && let Ok(url) = url.join(&domain)
            {
                urls.push(url.into());
            }
            let mut pending = FuturesUnordered::new();
            pending.push(self.srv_settings(email, &domain).boxed());
            pending.push(self.autodiscover(email, &domain).boxed());
            for url in urls {
                pending.push(document(url, email, None).boxed());
            }
            while let Some(result) = pending.next().await {
                if result.is_some() {
                    return result;
                }
            }
            None
        };
        Ok(timeout(BUDGET, lookups)
            .await
            .ok()
            .flatten()
            .unwrap_or(direct))
    }
}
