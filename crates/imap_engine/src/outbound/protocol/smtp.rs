//! Account- and generation-scoped SMTP socket reuse.
use super::*;
use mailparse::MailHeaderMap;
use std::{collections::BTreeMap, time::Instant};

const MIN_RETRY_BUDGET: Duration = Duration::from_secs(30);

#[derive(Default)]
pub(super) struct Extensions {
    pub(super) utf8: bool,
    pub(super) eight_bit: bool,
    pub(super) size: Option<u64>,
    plain: bool,
    login: bool,
}

impl Extensions {
    fn parse(response: &[u8]) -> Self {
        let mut parsed = Self::default();
        // The first EHLO line is a server greeting. Extension names begin on subsequent lines.
        for line in response.split(|b| *b == b'\n').skip(1).take(99) {
            let Some(fields) = line.get(4..) else {
                continue;
            };
            let mut words = fields
                .split(|b| b.is_ascii_whitespace() || *b == b'=')
                .filter(|w| !w.is_empty());
            let Some(name) = words.next() else { continue };
            if name.eq_ignore_ascii_case(b"SMTPUTF8") {
                parsed.utf8 = true;
            } else if name.eq_ignore_ascii_case(b"8BITMIME") {
                parsed.eight_bit = true;
            } else if name.eq_ignore_ascii_case(b"SIZE") {
                parsed.size = words
                    .next()
                    .and_then(|s| std::str::from_utf8(s).ok()?.parse::<u64>().ok())
                    .filter(|s| *s != 0);
            } else if name.eq_ignore_ascii_case(b"AUTH") {
                for method in words {
                    parsed.plain |= method.eq_ignore_ascii_case(b"PLAIN");
                    parsed.login |= method.eq_ignore_ascii_case(b"LOGIN");
                }
            }
        }
        parsed
    }
}

// RFC 1870 counts canonical CRLF line endings and excludes dot transparency and the terminator.
fn data_block(wire: &str) -> Result<(Vec<u8>, u64), Error> {
    let mut data = Vec::with_capacity(wire.len().saturating_add(5));
    let mut size = 0u64;
    for line in wire.split_inclusive('\n') {
        let text = line.strip_suffix('\n').unwrap_or(line);
        let text = text.strip_suffix('\r').unwrap_or(text);
        if text.contains('\r') {
            return Err(Error::Invalid);
        }
        if text.starts_with('.') {
            data.push(b'.');
        }
        data.extend_from_slice(text.as_bytes());
        data.extend_from_slice(b"\r\n");
        size += text.len() as u64 + 2;
    }
    data.extend_from_slice(b".\r\n");
    Ok((data, size))
}

#[cfg(test)]
mod extensions_test;

#[cfg(test)]
mod authentication_test;

#[cfg(test)]
mod reuse_test;

#[cfg(test)]
pub(in crate::outbound::protocol) mod retry_test;

#[cfg(test)]
mod telemetry_test;

pub(super) struct Pooled {
    stream: Stream,
    extensions: Extensions,
    opened: Instant,
    last_used: Instant,
    messages: u16,
}
pub(super) type Pool = BTreeMap<String, Pooled>;

impl ProtocolTransport {
    pub(super) async fn reclaim_smtp(&self) {
        self.smtp_pool.lock().await.retain(|_, s| {
            s.last_used.elapsed() < Duration::from_secs(600)
                && s.opened.elapsed() < Duration::from_secs(1800)
                && s.messages < 100
        });
    }
    fn smtp_key(credentials: &Credentials) -> Option<String> {
        let binding = credentials.binding?;
        let endpoint = serde_json::to_vec(&credentials.smtp.endpoint).ok()?;
        Some(format!(
            "{}:{}:{}:{:x}",
            binding.link_id,
            binding.sync_generation,
            binding.grant_generation,
            Sha256::digest(endpoint)
        ))
    }
    pub(super) async fn evict_smtp(&self, binding: Binding) {
        let prefix = format!(
            "{}:{}:{}:",
            binding.link_id, binding.sync_generation, binding.grant_generation
        );
        self.smtp_pool
            .lock()
            .await
            .retain(|key, _| !key.starts_with(&prefix));
    }
    async fn take_smtp(
        &self,
        credentials: &Credentials,
    ) -> Result<(Option<String>, Pooled), Error> {
        let key = Self::smtp_key(credentials);
        let cached = {
            let mut pool = self.smtp_pool.lock().await;
            pool.retain(|_, connection| {
                connection.last_used.elapsed() < Duration::from_secs(600)
                    && connection.opened.elapsed() < Duration::from_secs(1800)
                    && connection.messages < 100
            });
            key.as_ref().and_then(|key| pool.remove(key))
        };
        if let Some(mut connection) = cached {
            // A peer may close its idle socket before our retention limit.
            // Probe outside the pool lock and before any new envelope bytes.
            match check_reuse(&mut connection.stream).await {
                Ok(()) => {
                    tracing::Span::current().record("smtp.probe", "ok");
                    return Ok((key, connection));
                }
                Err(error) => {
                    tracing::Span::current().record("smtp.probe", "evicted");
                    tracing::warn!(
                        smtp.phase = "rset",
                        error.code = ?error,
                        "Discarding unavailable pooled SMTP connection"
                    );
                }
            }
        }
        Ok((key, self.open_smtp(credentials).await?))
    }

    async fn open_smtp(&self, credentials: &Credentials) -> Result<Pooled, Error> {
        let (mut stream, extensions) = self.smtp_with_features(&credentials.smtp).await?;
        stream.enable_pooling();
        let now = Instant::now();
        Ok(Pooled {
            stream,
            extensions,
            opened: now,
            last_used: now,
            messages: 0,
        })
    }

    pub(super) async fn smtp_with_features(
        &self,
        login: &Login,
    ) -> Result<(Stream, Extensions), Error> {
        Connector::validate(&login.endpoint, false)?;
        let socket = self.connector.tcp(&login.endpoint).await?;
        let mut stream = if login.endpoint.tls == TlsMode::StartTls {
            socket
        } else {
            self.connector.tls(&login.endpoint, socket).await?
        };
        if response(&mut stream).await?.0 != 220 {
            return Err(Error::ConnectionUnavailable);
        }
        let mut advertised = ehlo(&mut stream).await?;
        if login.endpoint.tls == TlsMode::StartTls {
            // STARTTLS refusal is fatal; credentials have not been transmitted.
            command(&mut stream, b"STARTTLS\r\n", 220).await?;
            stream = self.connector.tls(&login.endpoint, stream).await?;
            advertised = ehlo(&mut stream).await?;
        }
        let extensions = Extensions::parse(&advertised);
        authenticate(&mut stream, &extensions, login).await?;
        Ok((stream, extensions))
    }
    #[tracing::instrument(
        name = "smtp.submit",
        skip_all,
        fields(
            smtp.attempt = tracing::field::Empty,
            smtp.probe = tracing::field::Empty,
            smtp.outcome = tracing::field::Empty,
        ),
        err,
    )]
    pub(super) async fn submit_inner(
        &self,
        c: &Credentials,
        from: &str,
        recipients: &[String],
        mime: &[u8],
        deadline: tokio::time::Instant,
    ) -> Result<SubmissionOutcome, Error> {
        let mut attempts = 0_i64;
        let result = async {
            if !from.eq_ignore_ascii_case(&c.email)
                || recipients.is_empty()
                || recipients.len() > 100
                || !address(from)
                || recipients.iter().any(|s| !address(s))
            {
                return Err(Error::Forbidden);
            }
            let wire = without_bcc(mime)?;
            let key = Self::smtp_key(c);
            // Both attempts use the same frozen MIME and durable send record. The
            // transport returns Unknown once message-body IO starts, so that path exits here
            // without reconnecting or submitting those bytes a second time.
            for attempt in 0..2 {
                if tokio::time::Instant::now() >= deadline {
                    return Err(Error::SendUnavailable);
                }
                attempts = i64::from(attempt + 1);
                let connection = match tokio::time::timeout_at(deadline, async {
                    if attempt == 0 {
                        self.take_smtp(c).await.map(|(_, connection)| connection)
                    } else {
                        self.open_smtp(c).await
                    }
                })
                .await
                {
                    Ok(connection) => connection,
                    Err(_) => Err(Error::SendUnavailable),
                };
                let result = match connection {
                    Ok(mut connection) => {
                        match deliver(
                            &mut connection.stream,
                            &connection.extensions,
                            from,
                            recipients,
                            &wire,
                            deadline,
                        )
                        .await
                        {
                            Ok(outcome) => {
                                if outcome == SubmissionOutcome::Accepted {
                                    connection.messages = connection.messages.saturating_add(1);
                                    connection.last_used = Instant::now();
                                    if let Some(key) = key {
                                        let mut pool = self.smtp_pool.lock().await;
                                        if pool.len() < 64 || pool.contains_key(&key) {
                                            pool.insert(key, connection);
                                        }
                                    }
                                }
                                return Ok(outcome);
                            }
                            Err(error) => error,
                        }
                    }
                    Err(error) => error,
                };
                let error = definite_submission_error(result);
                if error != Error::SendUnavailable
                    || attempt == 1
                    || deadline.saturating_duration_since(tokio::time::Instant::now())
                        < MIN_RETRY_BUDGET
                {
                    return Err(error);
                }
                tracing::warn!(
                    smtp.retry_count = 1_i64,
                    "Retrying unavailable SMTP connection before any message body byte"
                );
            }
            Err(Error::SendUnavailable)
        }
        .await;
        let outcome = match &result {
            Ok(SubmissionOutcome::Accepted) => "accepted",
            Ok(SubmissionOutcome::Unknown) => "unknown",
            Ok(SubmissionOutcome::Rejected { .. }) => "not_submitted",
            Err(_) => "not_submitted",
        };
        // Some exporters retain the first write. Publish final fields once,
        // after both attempts settle, so a success cannot retain failure data.
        let span = tracing::Span::current();
        span.record("smtp.attempt", attempts);
        span.record("smtp.outcome", outcome);
        result
    }
}

#[tracing::instrument(name = "smtp.connection.reuse", skip_all, fields(smtp.phase = "rset"), err(level = "warn"))]
async fn check_reuse<S: ResponseReader + AsyncWrite>(stream: &mut S) -> Result<(), Error> {
    timeout(Duration::from_secs(3), command(stream, b"RSET\r\n", 250))
        .await
        .map_err(|_| Error::ConnectionTimedOut)?
}

// Only an explicit pre-body transport result carries non-submission certainty.
// HTTP timeouts and generic service errors cannot be upgraded to this category.
fn definite_submission_error(error: Error) -> Error {
    match error {
        Error::ConnectionUnavailable
        | Error::ConnectionTimedOut
        | Error::DnsUnavailable
        | Error::TcpUnavailable
        | Error::TlsUnavailable => Error::SendUnavailable,
        error => error,
    }
}

/// RFC6531 requires SMTPUTF8 for internationalized headers at every MIME level.
fn international_headers(wire: &str) -> Result<bool, Error> {
    let parsed = mailparse::parse_mail(wire.as_bytes()).map_err(|_| Error::Invalid)?;
    let mut parts = vec![&parsed];
    while let Some(part) = parts.pop() {
        // RFC6532 permits encoded message/global attachments over a 7-bit transport.
        let encoded = part
            .headers
            .get_first_value("Content-Transfer-Encoding")
            .is_some_and(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "base64" | "quoted-printable"
                )
            });
        if (part.ctype.mimetype.eq_ignore_ascii_case("message/global") && !encoded)
            || part
                .headers
                .iter()
                .any(|h| !h.get_key_raw().is_ascii() || !h.get_value_raw().is_ascii())
        {
            return Ok(true);
        }
        parts.extend(&part.subparts);
    }
    Ok(false)
}

/// Deliver on an already authenticated connection using only its negotiated capabilities.
async fn deliver<S: ResponseReader + AsyncWrite>(
    stream: &mut S,
    extensions: &Extensions,
    from: &str,
    recipients: &[String],
    wire: &str,
    deadline: tokio::time::Instant,
) -> Result<SubmissionOutcome, Error> {
    if tokio::time::Instant::now() >= deadline {
        return Err(Error::SendUnavailable);
    }
    let utf8 = international_headers(wire)?
        || !from.is_ascii()
        || recipients.iter().any(|r| !r.is_ascii());
    let eight_bit = !wire.is_ascii();
    // Fail before MAIL/RCPT/DATA. These are definite non-deliveries, never Unknown sends.
    if (utf8 && !extensions.utf8) || (eight_bit && !extensions.eight_bit) {
        return Ok(SubmissionOutcome::Rejected {
            refusal: SubmissionRefusal {
                phase: SubmissionRefusalPhase::Message,
                recipient_index: None,
                reply_class: None,
            },
        });
    }
    let (data, size) = data_block(wire)?;
    let mut mail_from = format!("MAIL FROM:<{from}>");
    if let Some(limit) = extensions.size {
        if size > limit {
            return Ok(SubmissionOutcome::Rejected {
                refusal: SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Message,
                    recipient_index: None,
                    reply_class: None,
                },
            });
        }
        mail_from.push_str(&format!(" SIZE={size}"));
    }
    if utf8 {
        mail_from.push_str(" SMTPUTF8");
    }
    if eight_bit {
        mail_from.push_str(" BODY=8BITMIME");
    }
    mail_from.push_str("\r\n");
    // Connection setup and every envelope command share one absolute deadline.
    // Stop this timer before writing the body: cancellation after a body byte
    // cannot establish non-submission and must retain the Unknown outcome.
    let refusal = tokio::time::timeout_at(deadline, async {
        if let Some(reply_class) =
            submission_command(stream, mail_from.as_bytes(), 250, "mail-from").await?
        {
            return Ok(Some(SubmissionRefusal {
                phase: SubmissionRefusalPhase::Sender,
                recipient_index: None,
                reply_class: Some(reply_class),
            }));
        }
        for (index, recipient) in recipients.iter().enumerate() {
            // Abort the entire envelope at the first refused recipient. Even
            // accepted earlier recipients receive no DATA, so no partial send
            // can be replayed as a whole-message retry.
            if let Some(reply_class) = submission_command(
                stream,
                format!("RCPT TO:<{recipient}>\r\n").as_bytes(),
                250,
                "rcpt-to",
            )
            .await?
            {
                return Ok(Some(SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Recipient,
                    recipient_index: Some(u16::try_from(index).map_err(|_| Error::Invalid)?),
                    reply_class: Some(reply_class),
                }));
            }
        }
        if let Some(reply_class) =
            submission_command(stream, b"DATA\r\n", 354, "data-command").await?
        {
            return Ok(Some(SubmissionRefusal {
                phase: SubmissionRefusalPhase::Message,
                recipient_index: None,
                reply_class: Some(reply_class),
            }));
        }
        Ok::<_, Error>(None)
    })
    .await
    .map_err(|_| Error::SendUnavailable)??;
    if let Some(refusal) = refusal {
        return Ok(SubmissionOutcome::Rejected { refusal });
    }
    if tokio::time::Instant::now() >= deadline {
        return Err(Error::SendUnavailable);
    }
    // The transport entry point owns the one absolute deadline, including DATA
    // and its final reply. It retains Unknown if this exchange is cut off.
    if stream.write_all(&data).await.is_err() {
        tracing::warn!(
            smtp.phase = "data-body",
            "SMTP delivery remains unconfirmed"
        );
        return Ok(SubmissionOutcome::Unknown);
    }
    match response(stream).await {
        Ok((250, _)) => {
            tracing::info!(
                smtp.phase = "data-result",
                smtp.reply_class = 2_i64,
                "SMTP delivery accepted"
            );
            Ok(SubmissionOutcome::Accepted)
        }
        Ok((code, _)) => {
            // Delivery bytes have left the client. Retain the durable Unknown
            // fence and reconcile Sent rather than opening an automatic resend.
            tracing::warn!(
                smtp.phase = "data-result",
                smtp.reply_class = i64::from(code / 100),
                "SMTP delivery remains unconfirmed"
            );
            Ok(SubmissionOutcome::Unknown)
        }
        Err(_) => {
            tracing::warn!(
                smtp.phase = "data-result",
                "SMTP delivery remains unconfirmed"
            );
            Ok(SubmissionOutcome::Unknown)
        }
    }
}

#[tracing::instrument(name = "smtp.submission.command", skip_all, fields(smtp.phase = phase), err)]
async fn submission_command<S: ResponseReader + AsyncWrite>(
    stream: &mut S,
    bytes: &[u8],
    expected: u16,
    phase: &'static str,
) -> Result<Option<SubmissionRefusalClass>, Error> {
    stream
        .write_all(bytes)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
    let code = response(stream).await?.0;
    if code == expected || (phase == "rcpt-to" && matches!(code, 251 | 252)) {
        return Ok(None);
    }
    tracing::warn!(
        smtp.phase = phase,
        smtp.reply_class = i64::from(code / 100),
        "SMTP submission refused"
    );
    match code {
        400..=499 => Ok(Some(SubmissionRefusalClass::Temporary)),
        500..=599 => Ok(Some(SubmissionRefusalClass::Permanent)),
        _ => Err(Error::ConnectionUnavailable),
    }
}

#[cfg(test)]
mod timeout_test;
#[cfg(test)]
mod transcript_test;

// Authentication replies have different semantics from message-submission replies.
#[tracing::instrument(name = "smtp.authenticate", skip_all, fields(mail.stage = "smtp-auth"), err)]
async fn authenticate<S: ResponseReader + tokio::io::AsyncWrite>(
    stream: &mut S,
    extensions: &Extensions,
    login: &Login,
) -> Result<(), Error> {
    let code = if extensions.plain {
        let token = zeroize::Zeroizing::new(STANDARD.encode(format!(
            "\0{}\0{}",
            login.endpoint.username, login.password.0
        )));
        let auth = zeroize::Zeroizing::new(format!("AUTH PLAIN {}\r\n", token.as_str()));
        stream
            .write_all(auth.as_bytes())
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        response(stream).await?.0
    } else if extensions.login {
        auth_command(stream, b"AUTH LOGIN\r\n", 334).await?;
        let username =
            zeroize::Zeroizing::new(format!("{}\r\n", STANDARD.encode(&login.endpoint.username)));
        auth_command(stream, username.as_bytes(), 334).await?;
        let password =
            zeroize::Zeroizing::new(format!("{}\r\n", STANDARD.encode(&login.password.0)));
        stream
            .write_all(password.as_bytes())
            .await
            .map_err(|_| Error::ConnectionUnavailable)?;
        response(stream).await?.0
    } else {
        return Err(Error::Forbidden);
    };
    if code == 535 {
        return Err(Error::CredentialsRejected);
    }
    if matches!(code, 530 | 534 | 538) {
        return Err(Error::Forbidden);
    }
    if code != 235 {
        return Err(Error::ConnectionUnavailable);
    }
    Ok(())
}

async fn auth_command<S: ResponseReader + tokio::io::AsyncWrite>(
    stream: &mut S,
    bytes: &[u8],
    expected: u16,
) -> Result<(), Error> {
    stream
        .write_all(bytes)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
    match response(stream).await?.0 {
        code if code == expected => Ok(()),
        535 => Err(Error::CredentialsRejected),
        530 | 534 | 538 => Err(Error::Forbidden),
        _ => Err(Error::ConnectionUnavailable),
    }
}
