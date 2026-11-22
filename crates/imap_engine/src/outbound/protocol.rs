//! Real IMAP and SMTP protocol adapters; all connections use pinned verified TLS.
use super::network::{Connector, Stream};
mod commands;
mod folder_roles;
mod gmail;
mod identity;
mod login;
mod message;
mod sent;
mod smtp;
mod wire;
use crate::domain::{models::*, ports::*, server_features::ServerFeatures};
use async_imap::Session;
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::Utc;
use futures::{StreamExt, TryStreamExt};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncRead, AsyncWrite, AsyncWriteExt},
    time::{Duration, timeout},
};
use tracing::Instrument;
use wire::{address, command, flag_name, imap_error, line, quoted, response, without_bcc};

const IO_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_MESSAGES: usize = 1_000_000;

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
        Connector::validate(&login.endpoint, true)?;
        let socket = self.connector.tcp(&login.endpoint).await?;
        let stream = if login.endpoint.tls == TlsMode::StartTls {
            let mut plain = socket;
            let greeting = line(&mut plain).await?;
            if !greeting.starts_with(b"* OK") {
                return Err(Error::ConnectionUnavailable);
            }
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
            if !line(&mut stream).await?.starts_with(b"* OK") {
                return Err(Error::ConnectionUnavailable);
            }
            stream
        };
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
            .capabilities()
            .await
            .map_err(|e| imap_error(e, false))?;
        Ok(session)
    }

    async fn folders(&self, session: &mut Session<Stream>) -> Result<Vec<(Folder, String)>, Error> {
        let names = session
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
        timeout(SYNC_ROUND_BUDGET, async {
            let mut session = self.imap(&c.imap).await?;
            let mut catalog = self.folders(&mut session).await?;
            let mut preferences = match (&self.settings, c.binding) {
                (Some(settings), Some(binding)) => settings.preferences(binding).await?,
                _ => crate::domain::account_settings::FolderPreferences::default(),
            };
            preferences.retain_listed(catalog.iter().map(|(folder, _)| folder.id.as_str()));
            let capabilities = session
                .capabilities()
                .await
                .map_err(|e| imap_error(e, false))?;
            let gmail = capabilities.has_str("X-GM-EXT-1");
            let gmail_plan = if gmail {
                gmail::all_path(&mut session)
                    .await?
                    .map(|path| gmail::Plan::new(&catalog, path))
            } else {
                None
            };
            if let Some(plan) = &gmail_plan {
                for (folder, path) in &mut catalog {
                    if plan.is_all(path) {
                        folder.role = FolderRole::Archive;
                    }
                }
            }
            let selected_folders = folder_roles::monitored_ids(&catalog, &preferences);
            let condstore = capabilities.has_str("CONDSTORE");
            let objectid = capabilities.has_str("OBJECTID");
            let mut result = Vec::new();
            let mut total = 0;
            let known_locations = known
                .locations
                .iter()
                .map(|location| {
                    (
                        (
                            location.folder_id.as_str(),
                            location.uid_validity,
                            location.uid,
                        ),
                        location,
                    )
                })
                .collect::<std::collections::BTreeMap<_, _>>();
            for (mut folder, path) in catalog {
                if gmail_plan.as_ref().is_some_and(|p| p.is_all(&path)) {
                    folder.role = FolderRole::Archive;
                }
                let detected_role = Some(folder.role);
                folder.role = preferences.role(&folder);
                let virtual_label = gmail_plan.as_ref().and_then(|p| p.label(&folder.id));
                folder.sync_enabled = preferences.syncs(&folder.id)
                    && selected_folders.contains(&folder.id)
                    && folder.role != FolderRole::Drafts;
                if (!preferences.syncs(&folder.id)
                    && !gmail_plan.as_ref().is_some_and(|p| p.is_all(&path)))
                    || folder.role == FolderRole::Drafts
                    || gmail_plan.as_ref().is_some_and(|p| !p.physical(&folder.id))
                    || (!selected_folders.contains(&folder.id)
                        && !gmail_plan.as_ref().is_some_and(|p| p.physical(&folder.id)))
                {
                    folder.sync_enabled = false;
                    let previous = known.folders.get(&folder.id);
                    let path = if gmail_plan.as_ref().is_some_and(|p| !p.physical(&folder.id)) {
                        previous.map(|f| f.path.clone()).unwrap_or(path)
                    } else {
                        path
                    };
                    result.push(RemoteFolder {
                        virtual_label,
                        uid_next: previous.and_then(|f| f.uid_next),
                        phantom: previous.and_then(|f| f.phantom.clone()),
                        detected_role,
                        monitored: false,
                        uid_validity: previous.map(|f| f.uid_validity).unwrap_or(0),
                        highest_modseq: previous.and_then(|f| f.highest_modseq),
                        sync_tier: SyncTier::Full,
                        folder,
                        path,
                        messages: Vec::new(),
                    });
                    continue;
                }
                use crate::domain::folder_health::{FolderStatus, PhantomFolder};
                let previous = known.folders.get(&folder.id);
                let status = session
                    .status(&path, "(UIDVALIDITY UIDNEXT MESSAGES)")
                    .await;
                let status = match status {
                    Ok(status) => FolderStatus {
                        uid_validity: status.uid_validity,
                        uid_next: status.uid_next,
                        messages: status.exists,
                    },
                    Err(async_imap::error::Error::No(_)) => FolderStatus::default(),
                    Err(error) => return Err(imap_error(error, false)),
                };
                let now = Utc::now().timestamp_millis();
                let marker = previous.and_then(|f| f.phantom.as_ref());
                let skip = marker.is_some_and(|p| p.skip(status, now));
                let selected = if skip {
                    None
                } else {
                    match if condstore {
                        session.select_condstore(&path).await
                    } else {
                        session.select(&path).await
                    } {
                        Ok(selected) => Some(selected),
                        Err(async_imap::error::Error::No(_)) => None,
                        Err(error) => return Err(imap_error(error, false)),
                    }
                };
                let Some(selected) = selected else {
                    folder.sync_enabled = false;
                    result.push(RemoteFolder {
                        virtual_label,
                        uid_next: previous.and_then(|f| f.uid_next),
                        phantom: if skip {
                            marker.cloned()
                        } else {
                            Some(PhantomFolder::failed(marker, status, now))
                        },
                        detected_role,
                        monitored: false,
                        uid_validity: previous.map(|f| f.uid_validity).unwrap_or(0),
                        highest_modseq: previous.and_then(|f| f.highest_modseq),
                        sync_tier: SyncTier::Full,
                        folder,
                        path,
                        messages: Vec::new(),
                    });
                    continue;
                };
                folder.total_items = Some(selected.exists);
                let epoch = selected.uid_validity.ok_or(Error::ConnectionUnavailable)?;
                let mut uids = session
                    .uid_search("ALL")
                    .await
                    .map_err(|e| imap_error(e, false))?
                    .into_iter()
                    .collect::<Vec<_>>();
                uids.sort_unstable();
                total += uids.len();
                if total > MAX_MESSAGES {
                    return Err(Error::Throttled);
                }
                let previous = known
                    .folders
                    .get(&folder.id)
                    .filter(|f| f.uid_validity == epoch);
                let watermark = previous
                    .and_then(|f| f.highest_modseq)
                    .filter(|_| selected.highest_modseq.is_some());
                let tier = if watermark.is_some() {
                    SyncTier::Condstore
                } else {
                    SyncTier::Full
                };
                let mut messages = Vec::new();
                for chunk in uids.chunks(1000) {
                    let set = chunk
                        .iter()
                        .map(u32::to_string)
                        .collect::<Vec<_>>()
                        .join(",");
                    let native =
                        identity::fetch_native(&mut session, &set, gmail, objectid).await?;
                    let mut fields = String::from("UID FLAGS INTERNALDATE RFC822.SIZE");
                    if gmail {
                        fields.push_str(" X-GM-MSGID");
                    }
                    if selected.highest_modseq.is_some() {
                        fields.push_str(" MODSEQ");
                    }
                    let new_uids = chunk.iter().any(|uid| {
                        !known_locations.contains_key(&(folder.id.as_str(), epoch, *uid))
                    });
                    if new_uids {
                        fields.push_str(" BODY.PEEK[HEADER]");
                    }
                    let query = match watermark {
                        Some(n) => format!("({fields}) (CHANGEDSINCE {n})"),
                        None => format!("({fields})"),
                    };
                    let mut fetched = timeout(IO_TIMEOUT, session.uid_fetch(set, &query))
                        .await
                        .map_err(|_| Error::ConnectionUnavailable)?
                        .map_err(|e| imap_error(e, false))?
                        .take(1001)
                        .try_collect::<Vec<_>>()
                        .await
                        .map_err(|e| imap_error(e, false))?;
                    if fetched.len() > chunk.len() {
                        return Err(Error::Throttled);
                    }
                    let fetched_uids = fetched
                        .iter()
                        .filter_map(|f| f.uid)
                        .collect::<std::collections::BTreeSet<_>>();
                    for uid in chunk.iter().filter(|uid| !fetched_uids.contains(uid)) {
                        let cached = known_locations
                            .get(&(folder.id.as_str(), epoch, *uid))
                            .and_then(|l| known.messages.get(&l.message_id));
                        if let Some(cached) = cached {
                            use nom::{
                                IResult, Parser, bytes::complete::tag,
                                character::complete::u64 as number, sequence::preceded,
                            };
                            let parsed: IResult<&str, u64> =
                                preceded(tag("v1:"), number).parse(&cached.version);
                            messages.push(RemoteMessage {
                                gmail_labels: native
                                    .get(uid)
                                    .and_then(|(_, _, labels)| labels.clone()),
                                uid: *uid,
                                native_message_id: native.get(uid).and_then(|(m, _, _)| m.clone()),
                                native_thread_id: native.get(uid).and_then(|(_, t, _)| t.clone()),
                                flags: cached.flags.clone(),
                                size: cached.size,
                                mime: STANDARD
                                    .decode(&cached.mime_base64)
                                    .map_err(|_| Error::ConnectionUnavailable)?
                                    .into(),
                                received_at: cached.received_at,
                                modseq: parsed.ok().map(|(_, n)| n),
                                gmail_message_id: cached
                                    .id
                                    .strip_prefix("g:")
                                    .and_then(|s| u64::from_str_radix(s, 16).ok()),
                            });
                        } else {
                            // A new UID is always read, even if a broken server omits it from CHANGEDSINCE.
                            fetched.extend(
                                session
                                    .uid_fetch(uid.to_string(), format!("({fields})"))
                                    .await
                                    .map_err(|e| imap_error(e, false))?
                                    .take(1001)
                                    .try_collect::<Vec<_>>()
                                    .await
                                    .map_err(|e| imap_error(e, false))?,
                            );
                        }
                    }
                    if fetched.len() > chunk.len() {
                        return Err(Error::Throttled);
                    }
                    for item in fetched {
                        let uid = item.uid.ok_or(Error::ConnectionUnavailable)?;
                        if chunk.binary_search(&uid).is_err() {
                            return Err(Error::ConnectionUnavailable);
                        }
                        let cached = known_locations
                            .get(&(folder.id.as_str(), epoch, uid))
                            .and_then(|l| known.messages.get(&l.message_id));
                        let mime = if let Some(header) = item.header() {
                            header.to_vec()
                        } else if let Some(cached) = cached {
                            STANDARD
                                .decode(&cached.mime_base64)
                                .map_err(|_| Error::ConnectionUnavailable)?
                        } else {
                            let source = session
                                .uid_fetch(uid.to_string(), "BODY.PEEK[HEADER]")
                                .await
                                .map_err(|e| imap_error(e, false))?
                                .take(1001)
                                .try_collect::<Vec<_>>()
                                .await
                                .map_err(|e| imap_error(e, false))?;
                            source
                                .first()
                                .and_then(|f| f.header())
                                .ok_or(Error::ConnectionUnavailable)?
                                .to_vec()
                        };
                        if mime.len() > 25 * 1024 * 1024 {
                            return Err(Error::Throttled);
                        }
                        messages.push(RemoteMessage {
                            gmail_labels: native
                                .get(&uid)
                                .and_then(|(_, _, labels)| labels.clone()),
                            uid: item.uid.ok_or(Error::ConnectionUnavailable)?,
                            native_message_id: native.get(&uid).and_then(|(m, _, _)| m.clone()),
                            native_thread_id: native.get(&uid).and_then(|(_, t, _)| t.clone()),
                            flags: item.flags().map(flag_name).collect(),
                            size: item.size.ok_or(Error::ConnectionUnavailable)?,
                            mime: mime.into(),
                            received_at: item
                                .internal_date()
                                .map(|d| d.with_timezone(&Utc))
                                .unwrap_or(chrono::DateTime::UNIX_EPOCH),
                            modseq: item.modseq,
                            gmail_message_id: item.gmail_msg_id().copied(),
                        });
                    }
                }
                result.push(RemoteFolder {
                    virtual_label,
                    uid_next: selected.uid_next,
                    phantom: None,
                    detected_role,
                    monitored: true,
                    folder,
                    path,
                    uid_validity: epoch,
                    highest_modseq: selected.highest_modseq,
                    sync_tier: tier,
                    messages,
                });
            }
            if let Some(plan) = gmail_plan {
                plan.project(&mut result, &preferences, &selected_folders);
            }
            session.logout().await.map_err(|e| imap_error(e, false))?;
            Ok(result)
        })
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
    }
    #[tracing::instrument(skip_all, err)]
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
                .select(folder)
                .await
                .map_err(|e| imap_error(e, false))?;
            if selected.uid_validity != Some(epoch) {
                return Err(Error::Conflict);
            }
            let fetched = session
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
            self.return_command(c, session).await;
            Ok(bytes)
        })
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
    }
    #[tracing::instrument(skip_all, err)]
    async fn wait_change(&self, c: &Credentials, idle_seconds: u64) -> Result<(), Error> {
        let mut session = self.imap(&c.imap).await?;
        let capabilities = session
            .capabilities()
            .await
            .map_err(|e| imap_error(e, false))?;
        let folder = if capabilities.has_str("X-GM-EXT-1") {
            gmail::all_path(&mut session)
                .await?
                .unwrap_or_else(|| "INBOX".into())
        } else {
            "INBOX".into()
        };
        drop(session);
        self.wait_folder(c, &folder, idle_seconds).await
    }
    async fn wait_folder(
        &self,
        c: &Credentials,
        folder: &str,
        idle_seconds: u64,
    ) -> Result<(), Error> {
        timeout(Duration::from_secs(300), async {
            let mut session = self.imap(&c.imap).await?;
            let capabilities = session
                .capabilities()
                .await
                .map_err(|e| imap_error(e, false))?;
            if !capabilities.has_str("IDLE") {
                // Servers without push use a bounded protocol liveness interval.
                tokio::time::sleep(Duration::from_secs(30)).await;
                return Ok(());
            }
            session
                .select(folder)
                .await
                .map_err(|e| imap_error(e, false))?;
            let mut idle = session.idle();
            idle.init().await.map_err(|e| imap_error(e, false))?;
            {
                let (wait, _stop) =
                    idle.wait_with_timeout(Duration::from_secs(idle_seconds.clamp(10, 240)));
                wait.await.map_err(|e| imap_error(e, false))?;
            }
            let mut session = timeout(Duration::from_secs(10), idle.done())
                .await
                .map_err(|_| Error::ConnectionUnavailable)?
                .map_err(|e| imap_error(e, false))?;
            session.logout().await.map_err(|e| imap_error(e, false))?;
            Ok(())
        })
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
    }
    #[tracing::instrument(skip_all, err)]
    async fn apply(
        &self,
        c: &Credentials,
        folder: &str,
        epoch: u32,
        uid: u32,
        action: RemoteAction,
    ) -> Result<RemoteWriteReceipt, Error> {
        timeout(IO_TIMEOUT, self.apply_inner(c, folder, epoch, uid, action))
            .await
            .map_err(|_| Error::ConnectionUnavailable)?
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
        folder: &str,
        epoch: u32,
        uid: u32,
        action: RemoteAction,
    ) -> Result<RemoteWriteReceipt, Error> {
        let mut session = self.command_session(c).await?;
        let capabilities = session
            .capabilities()
            .await
            .map_err(|e| imap_error(e, false))?;
        let selected = if capabilities.has_str("CONDSTORE") {
            session.select_condstore(folder).await
        } else {
            session.select(folder).await
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
                        .uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
                        .await
                        .map_err(|e| imap_error(e, false))?
                        .take(1001)
                        .try_collect::<Vec<_>>()
                        .await
                        .map_err(|e| imap_error(e, false))?;
                    // UID EXPUNGE targets exactly this UID; ordinary EXPUNGE would delete other clients' mail.
                    session
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

async fn ehlo<S: AsyncRead + AsyncWrite + Unpin>(stream: &mut S) -> Result<Vec<u8>, Error> {
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
            .select("INBOX")
            .await
            .map_err(|e| imap_error(e, false))?;
        let _ = self.folders(&mut session).await?;
        let caps = session
            .capabilities()
            .await
            .map_err(|e| imap_error(e, false))?;
        session.logout().await.map_err(|e| imap_error(e, false))?;
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
