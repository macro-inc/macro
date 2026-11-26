//! Provider-specific plain-text DSNs, applied only to likely reports.
use super::*;

static RECIPIENT_MARKER: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:delivery[^:\n]{0,100}failed[^:\n]{0,50}|the following recipients were affected|the following address(?:es|\(es\))? failed|could not be delivered to(?: the following address)?|returned permanent errors?|RCPT TO):\s*<?([^<>@\s,]{1,256}@[^<>\s,]{1,256})"
);
static UNDELIVERABLE: Lazy<Regex> = lazy_regex!(
    r"(?i)the following message to <([^<>@\s]{1,256}@[^<>\s]{1,256})> was undeliverable"
);
static POSTFIX: Lazy<Regex> = lazy_regex!(
    r"(?im)<([^<>@\s]{1,256}@[^<>\s]{1,256})>:\s*host\s+[a-z0-9._-]+(?:\[[^\]\s]{1,256}\])?\s+said:\s*"
);
static ADDRESS_BLOCK: Lazy<Regex> = lazy_regex!(r"(?m)^\s*<([^<>@\s]{1,256}@[^<>\s]{1,256})>:\s*");
static DIAGNOSTIC: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:technical details of (?:permanent )?failure|the reason for the problem|remote host said):\s*"
);
static CARRIER: Lazy<Regex> = lazy_regex!(
    r"(?im)(?:message could not be delivered to mobile|error:[^\n]{0,256}?(?:invalid|no valid|not taken)[^\n]{0,512})"
);
static DELAY: Lazy<Regex> = lazy_regex!(
    r"(?i)warning message only|do not need to resend|has not yet been delivered|will keep trying|delivery attempts will continue|delivery (?:is|has been) delayed"
);
static GAVE_UP: Lazy<Regex> = lazy_regex!(
    r"(?i)permanent error|given up|not going to try again|retry timeout exceeded|will not be retried|could not be delivered"
);

fn first_paragraph(text: &str) -> Option<String> {
    let mut words = String::new();
    for line in text.trim_start().lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("---") || line.starts_with("Original message") {
            break;
        }
        if !words.is_empty() {
            words.push(' ');
        }
        words.push_str(line);
        if words.len() >= MAX_FIELD {
            break;
        }
    }
    (!words.is_empty()).then(|| bounded(&words))
}

fn block_diagnostic<'a>(body: &'a str, recipient: &str) -> Option<&'a str> {
    for block in body.split("\n\n").filter(|b| b.contains(recipient)) {
        if let Some(marker) = block.find(" host ")
            && let Some((_, text)) = block[marker..].split_once(':')
        {
            return Some(text);
        }
        if let Some((_, rest)) = block.split_once(recipient)
            && let Some((_, lines)) = rest.split_once('\n')
            && lines.starts_with("  ")
        {
            return Some(lines);
        }
    }
    None
}

pub(super) fn text_bounce(body: &str, headers: &Headers<'_>, out: &mut Vec<DeliveryReport>) {
    let body = body.replace("\r\n", "\n");
    let mut addresses = Vec::new();
    if let Some(failed) = field(headers, "x-failed-recipients") {
        recipients(&mut addresses, &failed);
    }
    let mut diagnostic = None;
    for (pattern, diagnostic_follows) in [
        (&*POSTFIX, true),
        (&*RECIPIENT_MARKER, false),
        (&*ADDRESS_BLOCK, true),
        (&*UNDELIVERABLE, false),
    ] {
        if let Some(found) = pattern.captures(&body) {
            if addresses.is_empty()
                && let Some(recipient) = found.get(1).and_then(|m| address(m.as_str()))
            {
                addresses.push(recipient);
            }
            if diagnostic_follows && let Some(marker) = found.get(0) {
                diagnostic = first_paragraph(&body[marker.end()..]);
            }
            break;
        }
    }
    if diagnostic.is_none()
        && let Some(marker) = DIAGNOSTIC.find(&body)
    {
        diagnostic = first_paragraph(&body[marker.end()..]);
    }
    if diagnostic.is_none()
        && let Some(marker) = SMTP_REPLY.find(&body)
    {
        diagnostic = first_paragraph(&body[marker.start()..]);
    }
    if diagnostic.is_none()
        && let Some(first) = addresses.first()
    {
        diagnostic = block_diagnostic(&body, first).and_then(first_paragraph);
    }
    if diagnostic.is_none() {
        diagnostic = CARRIER.find(&body).map(|m| bounded(m.as_str()));
    }
    let status = diagnostic
        .as_deref()
        .and_then(|v| SMTP_STATUS.find(v))
        .map(|m| m.as_str().to_owned());
    let temporary = status.as_deref().is_some_and(|s| s.starts_with("4."))
        || diagnostic
            .as_deref()
            .is_some_and(|s| s.as_bytes().first() == Some(&b'4'));
    let action = if DELAY.is_match(&body) || (temporary && !GAVE_UP.is_match(&body)) {
        DeliveryAction::Delayed
    } else {
        DeliveryAction::Failed
    };
    for recipient in addresses {
        out.push(DeliveryReport {
            recipient,
            action,
            status: status.clone(),
            diagnostic: diagnostic.clone(),
        });
    }
}
