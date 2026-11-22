//! Real IMAP and SMTP protocol adapters; all connections use pinned verified TLS.
use super::network::{
    Connector, MAX_SESSION_BYTES, ResponseLimit, ResponseReader, Stream, TransferBudget,
};
mod commands;
mod folder_roles;
mod gmail;
mod identity;
mod idle;
mod login;
mod message;
mod sent;
mod smtp;
mod snapshot;
mod wire;
use crate::domain::{models::*, ports::*, server_features::ServerFeatures};
use async_imap::Session;
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::Utc;
use futures::{StreamExt, TryStreamExt};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt},
    time::{Duration, timeout},
};
use tracing::Instrument;
use wire::{address, command, flag_name, imap_error, line, quoted, response, without_bcc};

const IO_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_MESSAGES: usize = 1_000_000;

/// Explicit command boundaries keep pooled sockets independent of lifetime bytes.
trait BoundedResponses {
    fn limit_response(&mut self, limit: ResponseLimit) -> &mut Self;
}
impl BoundedResponses for Session<Stream> {
    fn limit_response(&mut self, limit: ResponseLimit) -> &mut Self {
        self.get_mut().begin_response(limit);
        self
    }
}

/// IMAP/SMTP transport with no plaintext or arbitrary-port mode.
pub struct ProtocolTransport {
    connector: Connector,
    smtp_pool: tokio::sync::Mutex<smtp::Pool>,
    command_pool: tokio::sync::Mutex<commands::Pool>,
    command_capacity: std::sync::Mutex<
        std::collections::BTreeMap<String, std::sync::Weak<tokio::sync::Semaphore>>,
    >,
    settings: Option<std::sync::Arc<dyn crate::domain::account_settings::SettingsRepository>>,
}
impl ProtocolTransport {
    /// Use one shared connector and trust policy.
    pub fn new(connector: Connector) -> Self {
        Self {
            connector,
            smtp_pool: Default::default(),
            command_pool: Default::default(),
            command_capacity: Default::default(),
            settings: None,
        }
    }
    /// Apply validated owner routing/scan preferences when selecting folders.
    pub fn with_settings(
        mut self,
        settings: std::sync::Arc<dyn crate::domain::account_settings::SettingsRepository>,
    ) -> Self {
        self.settings = Some(settings);
        self
    }
    async fn imap(&self, login: &Login) -> Result<Session<Stream>, Error> {
        self.imap_with_budget(login, None).await
    }
    async fn imap_with_budget(
        &self,
        login: &Login,
        budget: Option<std::sync::Arc<TransferBudget>>,
    ) -> Result<Session<Stream>, Error> {
        Connector::validate(&login.endpoint, true)?;
        let mut socket = self.connector.tcp(&login.endpoint).await?;
        if let Some(budget) = budget {
            socket.attach_sync_budget(budget)?;
        }
        let stream = if login.endpoint.tls == TlsMode::StartTls {
            let mut plain = socket;
            plain.begin_response(ResponseLimit::Reply);
            let greeting = line(&mut plain).await?;
            if !greeting.starts_with(b"* OK") {
                return Err(Error::ConnectionUnavailable);
            }
            plain.begin_response(ResponseLimit::Reply);
            plain
                .write_all(b"m1 CAPABILITY\r\n")
                .await
                .map_err(|_| Error::ConnectionUnavailable)?;
            let mut starttls = false;
            loop {
                let response = line(&mut plain).await?;
                if response
                    .split(|b| b.is_ascii_whitespace())
                    .any(|v| v.eq_ignore_ascii_case(b"STARTTLS"))
                {
                    starttls = true;
                }
                if response.starts_with(b"m1 ") {
                    if !response.starts_with(b"m1 OK") || !starttls {
                        return Err(Error::Forbidden);
                    }
                    break;
                }
            }
            plain.begin_response(ResponseLimit::Reply);
            plain
                .write_all(b"m2 STARTTLS\r\n")
                .await
                .map_err(|_| Error::ConnectionUnavailable)?;
            if !line(&mut plain).await?.starts_with(b"m2 OK") {
                return Err(Error::Forbidden);
            }
            self.connector.tls(&login.endpoint, plain).await?
        } else {
            let mut stream = self.connector.tls(&login.endpoint, socket).await?;
            stream.begin_response(ResponseLimit::Reply);
            if !line(&mut stream).await?.starts_with(b"* OK") {
                return Err(Error::ConnectionUnavailable);
            }
            stream
        };
        let mut stream = stream;
        stream.begin_response(ResponseLimit::Reply);
        let client = async_imap::Client::new(stream);
        let mut session = async {
            timeout(
                IO_TIMEOUT,
                client.login(&login.endpoint.username, &login.password.0),
            )
            .await
            .map_err(|_| Error::ConnectionTimedOut)?
            .map_err(|(error, _)| {
                let classified = imap_error(error, true);
                tracing::warn!(
                    mail.stage = "imap-login",
                    error.code = %classified,
                    "Mail authentication failed"
                );
                classified
            })
        }
        .instrument(tracing::info_span!(
            "imap.authenticate",
            mail.stage = "imap-login"
        ))
        .await?;
        // Capabilities obtained before STARTTLS are untrusted; query again after TLS+login.
        session
            .limit_response(ResponseLimit::Metadata)
            .capabilities()
            .await
            .map_err(|e| imap_error(e, false))?;
        Ok(session)
    }

    async fn folders(&self, session: &mut Session<Stream>) -> Result<Vec<(Folder, String)>, Error> {
        let names = session
            .limit_response(ResponseLimit::Catalog)
            .list(Some(""), Some("*"))
            .await
            .map_err(|e| imap_error(e, false))?
            .take(MAX_FOLDER_CATALOG + 1)
            .try_collect::<Vec<_>>()
            .await
            .map_err(|e| imap_error(e, false))?;
        if names.len() > MAX_FOLDER_CATALOG {
            return Err(Error::Throttled);
        }
        let mut folders = Vec::new();
        let mut priorities = Vec::new();
        for n in names {
            let attrs = format!("{:?}", n.attributes()).to_ascii_lowercase();
            if n.attributes().iter().any(|attribute| {
                matches!(attribute, imap_proto::NameAttribute::NoSelect)
                    || matches!(attribute, imap_proto::NameAttribute::Extension(value)
                        if value.eq_ignore_ascii_case("\\NonExistent"))
            }) {
                continue;
            }
            let path = n.name().to_owned();
            let (role, priority) = folder_roles::detect(&path, n.delimiter(), n.attributes());
            priorities.push(priority);
            let id = format!("f:{:x}", Sha256::digest(path.as_bytes()));
            folders.push((
                Folder {
                    sync_enabled: true,
                    id,
                    parent_id: n
                        .delimiter()
                        .and_then(|delimiter| path.rsplit_once(delimiter))
                        .map(|(parent, _)| format!("f:{:x}", Sha256::digest(parent.as_bytes()))),
                    name: folder_roles::display_path(&path),
                    role,
                    has_children: attrs.contains("haschildren"),
                    total_items: None,
                },
                path,
            ));
        }
        let ids = folders
            .iter()
            .map(|(folder, _)| folder.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        for (folder, _) in &mut folders {
            if folder
                .parent_id
                .as_ref()
                .is_some_and(|id| !ids.contains(id))
            {
                folder.parent_id = None;
            }
        }
        folder_roles::unique_roles(&mut folders, &priorities);
        Ok(folders)
    }
}
#[async_trait::async_trait]
impl MailTransport for ProtocolTransport {
    async fn maintenance(&self) {
        self.reclaim_commands().await;
        self.reclaim_smtp().await;
    }
    async fn disconnect(&self, binding: Binding) -> Result<(), Error> {
        self.evict_smtp(binding).await;
        self.evict_commands(binding).await;
        Ok(())
    }
    #[tracing::instrument(skip_all, err)]
    async fn verify(&self, c: &Credentials) -> Result<(), Error> {
        self.verify_features(c).await.map(|_| ())
    }

    async fn verify_features(&self, c: &Credentials) -> Result<Option<ServerFeatures>, Error> {
        timeout(IO_TIMEOUT, self.verify_inner(c))
            .await
            .map_err(|_| Error::ConnectionTimedOut)?
            .map(Some)
    }
    #[tracing::instrument(skip_all, err)]
    async fn snapshot(
        &self,
        c: &Credentials,
        known: &AccountState,
    ) -> Result<Vec<RemoteFolder>, Error> {
        self.snapshot_inner(c, known).await
    }
    #[tracing::instrument(skip_all, fields(mail.response.bytes = tracing::field::Empty, mail.connection.read_bytes = tracing::field::Empty), err)]
    async fn message(
        &self,
        c: &Credentials,
        folder: &str,
        epoch: u32,
        uid: u32,
    ) -> Result<Option<RemoteMessage>, Error> {
        self.read_remote(c, folder, epoch, uid).await
    }
    async fn source(
        &self,
        c: &Credentials,
        folder: &str,
        epoch: u32,
        uid: u32,
    ) -> Result<Vec<u8>, Error> {
        timeout(IO_TIMEOUT, async {
            let mut session = self.command_session(c).await?;
            let selected = session
                .limit_response(ResponseLimit::Metadata)
                .select(folder)
                .await
                .map_err(|e| imap_error(e, false))?;
            if selected.uid_validity != Some(epoch) {
                return Err(Error::Conflict);
            }
            let fetched = session
                .limit_response(ResponseLimit::Source)
                .uid_fetch(uid.to_string(), "(UID RFC822.SIZE BODY.PEEK[])")
                .await
                .map_err(|e| imap_error(e, false))?
                .take(1001)
                .try_collect::<Vec<_>>()
                .await
                .map_err(|e| imap_error(e, false))?;
            let bytes = fetched
                .first()
                .and_then(|m| m.body())
                .ok_or(Error::NotFound)?
                .to_vec();
            if bytes.len()
                > usize::try_from(MAX_MESSAGE_SOURCE_BYTES).map_err(|_| Error::Invalid)?
            {
                return Err(Error::MessageTooLarge);
            }
            let span = tracing::Span::current();
            span.record(
                "mail.response.bytes",
                i64::try_from(session.get_mut().response_bytes()).unwrap_or(i64::MAX),
            );
            span.record(
                "mail.connection.read_bytes",
                i64::try_from(session.get_mut().lifetime_bytes()).unwrap_or(i64::MAX),
            );
            self.return_command(c, session).await;
            Ok(bytes)
        })
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
    }
    #[tracing::instrument(skip_all, err)]
    async fn wait_change(
        &self,
        c: &Credentials,
        committed: &[FolderState],
        idle_seconds: u64,
    ) -> Result<WaitOutcome, Error> {
        let mut session = self.imap(&c.imap).await?;
        let capabilities = session
            .limit_response(ResponseLimit::Metadata)
            .capabilities()
            .await
            .map_err(|e| imap_error(e, false))?;
        let gmail = capabilities.has_str("X-GM-EXT-1");
        let path = if gmail {
            gmail::all_path(&mut session)
                .await?
                .unwrap_or_else(|| "INBOX".into())
        } else {
            "INBOX".into()
        };
        drop(session);
        // Gmail's derived feeds share the All Mail wire path, but their counts
        // are filtered. Only the physical feed is a valid SELECT baseline.
        let target = committed.iter().find(|folder| {
            let same_path = folder.path == path
                || (path.eq_ignore_ascii_case("INBOX")
                    && folder.path.eq_ignore_ascii_case("INBOX"));
            same_path
                && (!gmail
                    || path.eq_ignore_ascii_case("INBOX")
                    || folder.virtual_label.as_deref() == Some("\\All"))
        });
        let Some(target) = target else {
            // An incomplete catalog has no safe comparison baseline. Keep the
            // bounded polling fallback instead of spinning full scans.
            tokio::time::sleep(Duration::from_secs(30)).await;
            return Ok(WaitOutcome::Restarted);
        };
        self.wait_folder(c, target, idle_seconds).await
    }
    #[tracing::instrument(skip_all, name = "imap.idle.wait", fields(
        idle.outcome = tracing::field::Empty,
        idle.changed_at_arm = tracing::field::Empty,
    ), err)]
    async fn wait_folder(
        &self,
        c: &Credentials,
        committed: &FolderState,
        idle_seconds: u64,
    ) -> Result<WaitOutcome, Error> {
        let result = timeout(Duration::from_secs(300), async {
            let mut session = self.imap(&c.imap).await?;
            let capabilities = session
                .limit_response(ResponseLimit::Metadata)
                .capabilities()
                .await
                .map_err(|e| imap_error(e, false))?;
            if !capabilities.has_str("IDLE") {
                tokio::time::sleep(Duration::from_secs(30)).await;
                return Ok((WaitOutcome::Restarted, false));
            }
            let selected = if capabilities.has_str("CONDSTORE") {
                session
                    .limit_response(ResponseLimit::Metadata)
                    .select_condstore(&committed.path)
                    .await
            } else {
                session
                    .limit_response(ResponseLimit::Metadata)
                    .select(&committed.path)
                    .await
            }
            .map_err(|e| imap_error(e, false))?;
            let unsolicited = session.unsolicited_responses.clone();
            let mut changed = idle::selected_changed(committed, &selected);
            while let Ok(response) = unsolicited.try_recv() {
                changed |= idle::unsolicited_changed(&response);
            }
            if changed {
                // The committed scan predates this SELECT. No IDLE has been
                // started, so closing the fresh socket is sufficient.
                return Ok((WaitOutcome::Changed, true));
            }
            session.get_mut().begin_response(ResponseLimit::Metadata);
            let mut handle = session.idle();
            handle.init().await.map_err(|e| imap_error(e, false))?;
            // async-imap queues data received before the IDLE continuation.
            // Its later wait reads only the socket; consume that queue first.
            while let Ok(response) = unsolicited.try_recv() {
                changed |= idle::unsolicited_changed(&response);
            }
            let outcome = if changed {
                WaitOutcome::Changed
            } else {
                let duration = Duration::from_secs(idle_seconds.clamp(10, 240));
                let (wait, _stop) = handle.wait_with_timeout(duration);
                // The library's timer measures inactivity and is reset by
                // keepalives. This outer deadline is absolute and planned.
                match timeout(duration, wait).await {
                    Err(_) => WaitOutcome::Restarted,
                    Ok(Ok(
                        async_imap::extensions::idle::IdleResponse::Timeout
                        | async_imap::extensions::idle::IdleResponse::ManualInterrupt,
                    )) => WaitOutcome::Restarted,
                    Ok(Ok(async_imap::extensions::idle::IdleResponse::NewData(_))) => {
                        WaitOutcome::Changed
                    }
                    Ok(Err(error)) => return Err(imap_error(error, false)),
                }
            };
            let mut session = timeout(Duration::from_secs(10), handle.done())
                .await
                .map_err(|_| Error::ConnectionUnavailable)?
                .map_err(|e| imap_error(e, false))?;
            session
                .limit_response(ResponseLimit::Metadata)
                .logout()
                .await
                .map_err(|e| imap_error(e, false))?;
            Ok((outcome, changed))
        })
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        result.map(|(outcome, changed)| {
            tracing::Span::current().record("idle.outcome", outcome.as_ref());
            tracing::Span::current().record("idle.changed_at_arm", changed);
            outcome
        })
    }
    #[tracing::instrument(skip_all, err)]
    async fn apply(
        &self,
        c: &Credentials,
        folder: &str,
        epoch: u32,
        uid: u32,
        action: RemoteAction,
    ) -> Result<RemoteWriteReceipt, ApplyError> {
        timeout(IO_TIMEOUT, async {
            let session = self
                .command_session(c)
                .await
                .map_err(ApplyError::NotStarted)?;
            self.apply_inner(c, session, folder, epoch, uid, action)
                .await
                .map_err(ApplyError::Uncertain)
        })
        .await
        .map_err(|_| ApplyError::Uncertain(Error::ConnectionUnavailable))?
    }
    #[tracing::instrument(skip_all, err)]
    async fn submit(
        &self,
        c: &Credentials,
        from: &str,
        recipients: &[String],
        mime: &[u8],
        pre_body_deadline: tokio::time::Instant,
    ) -> Result<TransportSubmission, Error> {
        match timeout(
            Duration::from_secs(8 * 60),
            self.submit_inner(c, from, recipients, mime, pre_body_deadline),
        )
        .await
        {
            Ok(result) => result.map(|outcome| TransportSubmission {
                outcome,
                deadline_exceeded: false,
            }),
            Err(_) => Ok(TransportSubmission {
                outcome: SubmissionOutcome::Unknown,
                deadline_exceeded: true,
            }),
        }
    }
    #[tracing::instrument(skip_all, err)]
    async fn save_sent(
        &self,
        c: &Credentials,
        message_id: &str,
        mime: &[u8],
        allow_append: bool,
    ) -> Result<bool, Error> {
        timeout(
            IO_TIMEOUT,
            self.save_sent_inner(c, message_id, mime, allow_append),
        )
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
    }
}

#[cfg(test)]
mod test;

impl ProtocolTransport {
    #[tracing::instrument(skip_all, err)]
    async fn apply_inner(
        &self,
        c: &Credentials,
        mut session: commands::Command,
        folder: &str,
        epoch: u32,
        uid: u32,
        action: RemoteAction,
    ) -> Result<RemoteWriteReceipt, Error> {
        let capabilities = session
            .limit_response(ResponseLimit::Metadata)
            .capabilities()
            .await
            .map_err(|e| imap_error(e, false))?;
        let selected = if capabilities.has_str("CONDSTORE") {
            session
                .limit_response(ResponseLimit::Metadata)
                .select_condstore(folder)
                .await
        } else {
            session
                .limit_response(ResponseLimit::Metadata)
                .select(folder)
                .await
        }
        .map_err(|e| imap_error(e, false))?;
        if selected.uid_validity != Some(epoch) {
            return Err(Error::Conflict);
        }
        let (action, expected) = match action {
            RemoteAction::IfUnchanged { modseq, action } => (*action, Some(modseq)),
            action => (action, None),
        };
        let conditional = if selected.highest_modseq.is_some() {
            expected
                .filter(|m| *m > 0)
                .map(|m| format!("(UNCHANGEDSINCE {m}) "))
                .unwrap_or_default()
        } else {
            String::new()
        };
        let mut destination_uid = None;
        match action {
            RemoteAction::IfUnchanged { .. } => return Err(Error::Invalid),
            RemoteAction::Flag { flag, enabled } => {
                if !matches!(flag.as_str(), "\\Seen" | "\\Flagged" | "\\Answered") {
                    return Err(Error::Invalid);
                }
                let verb = if enabled {
                    "+FLAGS.SILENT"
                } else {
                    "-FLAGS.SILENT"
                };
                identity::store(&mut session, uid, &format!("{conditional}{verb} ({flag})"))
                    .await?;
            }
            RemoteAction::Keywords(keywords) => {
                if keywords.len() > 100
                    || keywords.iter().any(|s| {
                        s.is_empty()
                            || s.len() > 128
                            || s.bytes().any(|b| {
                                !b.is_ascii_alphanumeric() && !matches!(b, b'-' | b'_' | b'$')
                            })
                    })
                {
                    return Err(Error::Invalid);
                }
                let existing = session
                    .limit_response(ResponseLimit::Metadata)
                    .uid_fetch(uid.to_string(), "(FLAGS)")
                    .await
                    .map_err(|e| imap_error(e, false))?
                    .take(1001)
                    .try_collect::<Vec<_>>()
                    .await
                    .map_err(|e| imap_error(e, false))?;
                let Some(message) = existing.first() else {
                    return Err(Error::NotFound);
                };
                let mut flags = message
                    .flags()
                    .map(flag_name)
                    .filter(|f| f.starts_with('\\') && f != "\\Recent")
                    .collect::<Vec<_>>();
                flags.extend(keywords);
                identity::store(
                    &mut session,
                    uid,
                    &format!("{conditional}FLAGS.SILENT ({})", flags.join(" ")),
                )
                .await?;
            }
            RemoteAction::GmailLabels { add, remove } => {
                if !session
                    .limit_response(ResponseLimit::Metadata)
                    .capabilities()
                    .await
                    .map_err(|e| imap_error(e, false))?
                    .has_str("X-GM-EXT-1")
                {
                    return Err(Error::Forbidden);
                }
                if add.len() + remove.len() > 200
                    || add.iter().chain(&remove).any(|l| {
                        l.is_empty()
                            || l.len() > 1024
                            || l == "\\All"
                            || l.chars().any(char::is_control)
                    })
                {
                    return Err(Error::Invalid);
                }
                let fresh =
                    identity::fetch_native(&mut session, &uid.to_string(), true, false).await?;
                let labels = fresh
                    .get(&uid)
                    .and_then(|(_, _, labels)| labels.as_ref())
                    .ok_or(Error::NotFound)?;
                let mut labels = labels
                    .iter()
                    .filter(|l| !remove.contains(l))
                    .cloned()
                    .collect::<std::collections::BTreeSet<_>>();
                labels.extend(add);
                let labels = gmail::wire_labels(&labels)?;
                // One conditional STORE avoids incrementing MODSEQ between our own add/remove operations.
                identity::store(
                    &mut session,
                    uid,
                    &format!("{conditional}X-GM-LABELS ({labels})"),
                )
                .await?;
            }
            RemoteAction::Move(destination) => {
                if let Some(expected) =
                    expected.filter(|m| *m > 0 && selected.highest_modseq.is_some())
                {
                    let current = session
                        .limit_response(ResponseLimit::Metadata)
                        .uid_fetch(uid.to_string(), "(UID MODSEQ)")
                        .await
                        .map_err(|e| imap_error(e, false))?
                        .take(1001)
                        .try_collect::<Vec<_>>()
                        .await
                        .map_err(|e| imap_error(e, false))?;
                    if current.first().and_then(|m| m.modseq) != Some(expected) {
                        return Err(Error::Conflict);
                    }
                }
                let capabilities = session
                    .limit_response(ResponseLimit::Metadata)
                    .capabilities()
                    .await
                    .map_err(|e| imap_error(e, false))?;
                if capabilities.has_str("MOVE") {
                    destination_uid =
                        identity::transfer(&mut session, uid, &destination, true).await?;
                } else if capabilities.has_str("UIDPLUS") {
                    destination_uid =
                        identity::transfer(&mut session, uid, &destination, false).await?;
                    session
                        .limit_response(ResponseLimit::Metadata)
                        .uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
                        .await
                        .map_err(|e| imap_error(e, false))?
                        .take(1001)
                        .try_collect::<Vec<_>>()
                        .await
                        .map_err(|e| imap_error(e, false))?;
                    // UID EXPUNGE targets exactly this UID; ordinary EXPUNGE would delete other clients' mail.
                    session
                        .limit_response(ResponseLimit::Metadata)
                        .run_command_and_check_ok(format!("UID EXPUNGE {uid}"))
                        .await
                        .map_err(|e| imap_error(e, false))?;
                } else {
                    return Err(Error::Forbidden);
                }
            }
        }
        self.return_command(c, session).await;
        Ok(RemoteWriteReceipt { destination_uid })
    }
}

async fn ehlo<S: ResponseReader + AsyncWrite>(stream: &mut S) -> Result<Vec<u8>, Error> {
    stream
        .write_all(b"EHLO macro.com\r\n")
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
    let (code, lines) = response(stream).await?;
    if code != 250 {
        return Err(Error::ConnectionUnavailable);
    }
    Ok(lines)
}

impl ProtocolTransport {
    #[tracing::instrument(skip_all, err)]
    async fn verify_inner(&self, c: &Credentials) -> Result<ServerFeatures, Error> {
        let mut session = self.imap(&c.imap).await?;
        session
            .limit_response(ResponseLimit::Metadata)
            .select("INBOX")
            .await
            .map_err(|e| imap_error(e, false))?;
        let _ = self.folders(&mut session).await?;
        let caps = session
            .limit_response(ResponseLimit::Metadata)
            .capabilities()
            .await
            .map_err(|e| imap_error(e, false))?;
        session
            .limit_response(ResponseLimit::Metadata)
            .logout()
            .await
            .map_err(|e| imap_error(e, false))?;
        let (mut smtp, extensions) = self.smtp_with_features(&c.smtp).await?;
        command(&mut smtp, b"QUIT\r\n", 221).await?;
        Ok(ServerFeatures {
            verified_at: Some(Utc::now()),
            idle: caps.has_str("IDLE"),
            condstore: caps.has_str("CONDSTORE"),
            uid_plus: caps.has_str("UIDPLUS"),
            move_messages: caps.has_str("MOVE"),
            object_id: caps.has_str("OBJECTID"),
            gmail_extensions: caps.has_str("X-GM-EXT-1"),
            smtp_utf8: extensions.utf8,
            eight_bit_mime: extensions.eight_bit,
            send_limit_bytes: extensions.size,
        })
    }
}
