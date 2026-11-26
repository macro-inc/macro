//! Read delivery status, abuse feedback and automatic-reply evidence from a received message.
//! Derived from EmailEngine's bounce-detect.js, arf-detect.js and base-client.js.
use lazy_regex::{Lazy, Regex, lazy_regex};
use mailparse::{MailHeader, MailHeaderMap};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

const MAX_HEADER_BYTES: usize = 262_144;
const MAX_REPORT_BYTES: usize = 20 * 1024 * 1024;
const MAX_FIELD: usize = 2048;
const MAX_REPORTS: usize = 128;

type Headers<'a> = [MailHeader<'a>];

/// Provider feedback is metadata. It is never proof that a matching outbound send succeeded.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct Classification {
    /// RFC 3464 recipient results, preserving recipients with different outcomes.
    pub delivery: Vec<DeliveryReport>,
    /// RFC 5965 complaint or supported vendor complaint.
    pub complaint: Option<Complaint>,
    /// RFC 3834 and vendor auto-response markers.
    pub auto_reply: bool,
    /// Message-ID of the original message from attached headers, if present.
    pub original_message_id: Option<String>,
}

/// Standard DSN actions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryAction {
    /// Delivery failed permanently.
    Failed,
    /// The provider continues trying.
    Delayed,
    /// Delivery was successful.
    Delivered,
    /// An intermediary forwarded the message.
    Relayed,
    /// A distribution list expanded.
    Expanded,
}

/// Delivery status for one original recipient.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryReport {
    /// Recipient in the report.
    pub recipient: String,
    /// Failed, delayed, delivered, relayed, or expanded.
    pub action: DeliveryAction,
    /// Enhanced delivery status, such as 5.1.1.
    pub status: Option<String>,
    /// Provider's bounded diagnostic.
    pub diagnostic: Option<String>,
}

/// Fields of an Abuse Reporting Format feedback report.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct Complaint {
    /// Feedback-Type such as abuse, fraud or opt-out.
    pub feedback_type: String,
    /// Distinct original recipients in provider-reported order.
    pub recipients: Vec<String>,
    /// Original envelope sender.
    pub original_mail_from: Option<String>,
    /// Provider's source IP, if supplied.
    pub source_ip: Option<String>,
}

static AUTO_SUBJECT: Lazy<Regex> =
    lazy_regex!(r"(?i)^(auto(matic)?\s*(reply|response)|out of(?: the)? office|OOF:|OOO:)");
static BOUNCE_FROM: Lazy<Regex> = lazy_regex!(
    r"(?i)Mail Delivery (Sub)?System|Internet Mail Delivery|Mailer[- ]?Daemon|NDR Administrator|postmaster@"
);
static ADDRESS: Lazy<Regex> =
    lazy_regex!(r"(?i)[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}");
static SMTP_STATUS: Lazy<Regex> = lazy_regex!(r"\b([245]\.[0-9]{1,3}\.[0-9]{1,3})\b");
static SMTP_REPLY: Lazy<Regex> = lazy_regex!(r"(?m)\b([45][0-9]{2})[ -]");

fn bounded(value: &str) -> String {
    value.trim().chars().take(MAX_FIELD).collect()
}

fn field(headers: &Headers<'_>, key: &str) -> Option<String> {
    headers
        .get_first_value(key)
        .map(|v| bounded(&v))
        .filter(|v| !v.is_empty())
}

fn address(value: &str) -> Option<String> {
    ADDRESS.find(value).map(|v| v.as_str().to_owned())
}

fn recipients(to: &mut Vec<String>, value: &str) {
    for found in ADDRESS.find_iter(value).take(MAX_REPORTS) {
        if to.len() < MAX_REPORTS && !to.iter().any(|v| v.eq_ignore_ascii_case(found.as_str())) {
            to.push(found.as_str().to_owned());
        }
    }
}

fn auto_reply(headers: &Headers<'_>, subject: &str) -> bool {
    if AUTO_SUBJECT.is_match(subject)
        || (subject.to_ascii_lowercase().starts_with("auto:")
            && field(headers, "In-Reply-To").is_some())
    {
        return true;
    }
    let normalized = |key: &str, wanted: &str| {
        headers.get_all_values(key).iter().any(|v| {
            v.to_ascii_lowercase()
                .replace(['-', '_'], "")
                .contains(wanted)
        })
    };
    normalized("precedence", "autoreply")
        || normalized("auto-submitted", "autoreplied")
        || [
            "x-auto-response-suppress",
            "x-autoresponder",
            "x-autorespond",
            "x-autoreply",
        ]
        .iter()
        .any(|k| headers.get_first_header(k).is_some())
}

fn delivery_blocks(body: &str, out: &mut Vec<DeliveryReport>) {
    for block in body.split("\n\n") {
        if out.len() >= MAX_REPORTS {
            break;
        }
        let Ok((headers, _)) = mailparse::parse_headers(block.trim().as_bytes()) else {
            continue;
        };
        let Some(recipient) = field(&headers, "final-recipient")
            .or_else(|| field(&headers, "original-recipient"))
            .and_then(|v| address(&v))
        else {
            continue;
        };
        let status = field(&headers, "status");
        let action = match field(&headers, "action")
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("failed") => DeliveryAction::Failed,
            Some("delayed") => DeliveryAction::Delayed,
            Some("delivered") => DeliveryAction::Delivered,
            Some("relayed") => DeliveryAction::Relayed,
            Some("expanded") => DeliveryAction::Expanded,
            None => match status.as_deref().and_then(|s| s.as_bytes().first()) {
                Some(b'5') => DeliveryAction::Failed,
                Some(b'4') => DeliveryAction::Delayed,
                Some(b'2') => DeliveryAction::Delivered,
                _ => continue,
            },
            _ => continue,
        };
        out.push(DeliveryReport {
            recipient,
            action,
            status,
            diagnostic: field(&headers, "diagnostic-code"),
        });
    }
}

fn feedback(body: &[u8], report: &mut Complaint) {
    let Ok((headers, _)) = mailparse::parse_headers(body) else {
        return;
    };
    if let Some(value) = field(&headers, "feedback-type") {
        report.feedback_type = value.to_ascii_lowercase();
    }
    for value in headers.get_all_values("original-rcpt-to") {
        recipients(&mut report.recipients, &value);
    }
    if let Some(sender) = field(&headers, "original-mail-from").and_then(|v| address(&v)) {
        report.original_mail_from = Some(sender);
    }
    if let Some(ip) = field(&headers, "source-ip").and_then(|v| v.parse::<std::net::IpAddr>().ok())
    {
        report.source_ip = Some(ip.to_string());
    }
}

mod text;
use text::text_bounce;

/// Classify without mutating or rejecting the incoming email. A malformed,
/// oversized, or deeply nested report still retains its ordinary message.
pub fn classify(mime: &[u8]) -> Classification {
    let mut out = Classification::default();
    let header_window = &mime[..mime.len().min(MAX_HEADER_BYTES)];
    let Ok((headers, offset)) = mailparse::parse_headers(header_window) else {
        return out;
    };
    let subject = field(&headers, "subject").unwrap_or_default();
    out.auto_reply = auto_reply(&headers, &subject);
    let from = field(&headers, "from").unwrap_or_default();
    let workmail = field(&headers, "x-mailer").as_deref() == Some("Amazon WorkMail")
        && field(&headers, "thread-topic").as_deref()
            == Some("Undelivered Mail Returned to Sender");
    let zoho = field(&headers, "x-mailer").as_deref() == Some("Zoho Mail")
        && from.to_ascii_lowercase().contains("mailer-daemon@");
    let looks_bounce = workmail
        || BOUNCE_FROM.is_match(&from)
        || (subject.to_ascii_lowercase().starts_with("undeliverable:")
            && headers.get_first_header("auto-submitted").is_some());
    let hotmail = address(&from).is_some_and(|from| {
        from.split_once('@').is_some_and(|(local, domain)| {
            local.eq_ignore_ascii_case("staff") && domain.eq_ignore_ascii_case("hotmail.com")
        })
    });
    let report = field(&headers, "content-type")
        .is_some_and(|ct| ct.to_ascii_lowercase().starts_with("multipart/report"));
    // A feedback-report or delivery-status part can live in multipart/mixed too.
    // This inexpensive MIME marker check avoids parsing ordinary mail bodies.
    let mixed_report = field(&headers, "content-type")
        .is_some_and(|ct| ct.to_ascii_lowercase().starts_with("multipart/mixed"))
        && mime.len() <= MAX_REPORT_BYTES
        && mime.split(|b| *b == b'\n').any(|line| {
            line.len() < 1024
                && line
                    .get(..13)
                    .is_some_and(|k| k.eq_ignore_ascii_case(b"content-type:"))
                && line[13..]
                    .split(|b| b.is_ascii_whitespace() || *b == b';')
                    .any(|kind| {
                        kind.eq_ignore_ascii_case(b"message/feedback-report")
                            || kind.eq_ignore_ascii_case(b"message/delivery-status")
                    })
        });
    if !looks_bounce && !hotmail && !report && !mixed_report {
        return out;
    }
    if mime.len() > MAX_REPORT_BYTES
        || offset == 0
        || mime
            .split(|b| *b == b'\n')
            .filter(|line| line.starts_with(b"--"))
            .take(257)
            .count()
            > 256
    {
        return out;
    }
    let Ok(parsed) = mailparse::parse_mail(mime) else {
        return out;
    };
    let mut complaint = Complaint::default();
    let mut original_recipients = Vec::new();
    let mut text = None;
    for part in parsed.parts().take(MAX_REPORTS) {
        let kind = part.ctype.mimetype.to_ascii_lowercase();
        match kind.as_str() {
            "message/delivery-status" | "message/global-delivery-status" => {
                if let Ok(body) = part.get_body_raw() {
                    delivery_blocks(
                        &String::from_utf8_lossy(&body).replace("\r\n", "\n"),
                        &mut out.delivery,
                    );
                }
            }
            "message/feedback-report" => {
                if part.raw_bytes.len() <= MAX_HEADER_BYTES
                    && let Ok(body) = part.get_body_raw()
                {
                    feedback(&body, &mut complaint);
                }
            }
            "message/rfc822"
            | "message/rfc822-headers"
            | "text/rfc822-headers"
            | "text/rfc822-header" => {
                if let Ok(body) = part.get_body_raw()
                    && let Ok((original, _)) = mailparse::parse_headers(&body)
                {
                    if out.original_message_id.is_none() {
                        out.original_message_id = field(&original, "message-id");
                    }
                    for key in ["x-hmxmroriginalrecipient"] {
                        for value in original.get_all_values(key) {
                            recipients(&mut original_recipients, &value);
                        }
                    }
                    if hotmail && complaint.original_mail_from.is_none() {
                        complaint.original_mail_from =
                            field(&original, "return-path").and_then(|v| address(&v));
                    }
                }
            }
            "text/rfc822" if zoho => {
                if let Ok(body) = part.get_body() {
                    let headers = body
                        .lines()
                        .take(256)
                        .map(|line| line.strip_prefix(' ').unwrap_or(line))
                        .take_while(|line| !line.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n");
                    if let Ok((original, _)) = mailparse::parse_headers(headers.as_bytes()) {
                        out.original_message_id = field(&original, "message-id");
                    }
                }
                if out.original_message_id.is_none() {
                    out.original_message_id = field(&headers, "in-reply-to");
                }
            }
            "text/plain" if looks_bounce && text.is_none() => text = part.get_body().ok(),
            _ => {}
        }
    }
    if hotmail && !original_recipients.is_empty() && complaint.feedback_type.is_empty() {
        complaint.feedback_type = "abuse".into();
    }
    if !complaint.feedback_type.is_empty() {
        for addr in original_recipients {
            recipients(&mut complaint.recipients, &addr);
        }
        out.complaint = Some(complaint);
    }
    if out.delivery.is_empty()
        && looks_bounce
        && let Some(text) = text
    {
        let text: String = text.chars().take(50_000).collect();
        // Amazon WorkMail embeds DSN header blocks directly in its text part.
        let report = text
            .split_once("Technical report:")
            .map_or(text.as_str(), |(_, report)| report.trim());
        delivery_blocks(&report.replace("\r\n", "\n"), &mut out.delivery);
        if out.original_message_id.is_none() {
            out.original_message_id = text.lines().find_map(|line| {
                line.split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("message-id"))
                    .map(|(_, value)| bounded(value))
            });
        }
        if out.delivery.is_empty() {
            text_bounce(&text, &headers, &mut out.delivery);
        }
    }
    out
}

#[cfg(test)]
mod corpus;
#[cfg(test)]
mod test;
