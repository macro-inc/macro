//! Bounded Slack discovery and roster policy over typed workspace reads.

use super::{GatherMode, ImportServiceImpl, StageOutcome, gather_timeout};
use crate::domain::models::{
    ImportSource, Initiator, SlackChannelMeta, SlackConversation, SlackConversationId,
    SlackConversationKind, SlackConversationPage, SlackMemberPage, SlackParticipant, SlackUser,
    SlackUserId, SlackUserPage,
};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportRepo, SlackSourceError, SlackWorkspaceSession,
    SlackWorkspaceSource,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tokio::time::{Instant, timeout_at};
use uuid::Uuid;

#[cfg(test)]
mod test;

const MAX_CONVERSATION_PAGES: usize = 10;
const MAX_USER_PAGES: usize = 10;
const MAX_MEMBER_PAGES: usize = 5;
const MANUAL_MEMBER_BUDGET: usize = 100;
const NOTIFY_EVERY: usize = 10;
const RATE_LIMIT_MAX_SLEEP: Duration = Duration::from_secs(30);
// Finish best-effort work before spawn_gather's hard timeout can fail usable rows.
const ENRICHMENT_TIMEOUT_RESERVE: Duration = Duration::from_secs(10);

/// Default for hosts that have not attached a live Slack workspace reader.
pub struct NoSlackSource;

/// An uninhabited session: the default source never opens successfully.
pub enum NoSlackSession {}

impl SlackWorkspaceSource for NoSlackSource {
    type Session = NoSlackSession;

    async fn open(&self, _: &MacroUserIdStr<'static>) -> Result<Self::Session, SlackSourceError> {
        Err(SlackSourceError::NotConnected)
    }
}

impl SlackWorkspaceSession for NoSlackSession {
    async fn list_conversations(
        &self,
        _: Option<&str>,
    ) -> Result<SlackConversationPage, SlackSourceError> {
        match *self {}
    }

    async fn conversation_members(
        &self,
        _: &SlackConversationId,
        _: Option<&str>,
    ) -> Result<SlackMemberPage, SlackSourceError> {
        match *self {}
    }

    async fn list_users(&self, _: Option<&str>) -> Result<SlackUserPage, SlackSourceError> {
        match *self {}
    }
}

async fn retry_rate_limited<T, F, Fut>(mut read: F) -> Result<T, SlackSourceError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, SlackSourceError>>,
{
    match read().await {
        Err(SlackSourceError::RateLimited { retry_after }) => {
            tokio::time::sleep(
                retry_after
                    .unwrap_or(Duration::from_secs(5))
                    .min(RATE_LIMIT_MAX_SLEEP),
            )
            .await;
            read().await
        }
        result => result,
    }
}

pub(super) struct SlackDirectory(HashMap<SlackUserId, SlackUser>);

impl SlackDirectory {
    pub(super) async fn load(
        session: &impl SlackWorkspaceSession,
    ) -> Result<Self, SlackSourceError> {
        let mut users = HashMap::new();
        let mut cursor = None;
        for _ in 0..MAX_USER_PAGES {
            let page = retry_rate_limited(|| session.list_users(cursor.as_deref())).await?;
            users.extend(page.users.into_iter().map(|user| (user.id.clone(), user)));
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        Ok(Self(users))
    }
}

/// Live membership context shared by the accepted Slack rows in one batch.
pub(super) struct SlackBatch<Sess> {
    state: Option<Option<(Sess, SlackDirectory, Vec<MacroUserIdStr<'static>>)>>,
}

impl<Sess> Default for SlackBatch<Sess> {
    fn default() -> Self {
        Self { state: None }
    }
}

impl<Sess: SlackWorkspaceSession> SlackBatch<Sess> {
    pub(super) async fn resolve_emails<R, S, C, W>(
        &mut self,
        service: &ImportServiceImpl<R, S, C, W>,
        user: &MacroUserIdStr<'static>,
        team_id: Uuid,
        meta: &SlackChannelMeta,
    ) -> Vec<String>
    where
        R: ImportRepo + CanonicalImportRepo + Clone,
        S: ConnectorSelect,
        C: EntityCreator,
        W: SlackWorkspaceSource<Session = Sess>,
    {
        if self.state.is_none() {
            let loaded: anyhow::Result<_> = async {
                let session = service.slack_source.open(user).await?;
                let directory = SlackDirectory::load(&session).await?;
                let roster = service.repo.team_members(team_id).await?;
                Ok((session, directory, roster))
            }
            .await;
            self.state = Some(
                loaded
                    .inspect_err(|error| {
                        tracing::warn!(error = ?error, "Slack batch membership unavailable");
                    })
                    .ok(),
            );
        }

        if let Some(Some((session, directory, roster))) = &self.state
            && let Some(channel) = meta
                .channel_id
                .as_deref()
                .and_then(SlackConversationId::new)
        {
            match resolve_members(session, directory, &channel, roster).await {
                Ok(members) => {
                    return members
                        .participants
                        .into_iter()
                        .filter_map(|participant| participant.email)
                        .collect();
                }
                Err(error) => {
                    tracing::warn!(channel = %channel.as_str(), error = ?error, "Slack live membership resolution failed");
                }
            }
        }
        tracing::warn!(channel = ?meta.channel_id, "using staged Slack participants instead of live membership");
        meta.participants
            .iter()
            .filter_map(|participant| participant.email.clone())
            .collect()
    }
}

pub(super) struct ResolvedMembers {
    pub(super) participants: Vec<SlackParticipant>,
    pub(super) member_count: u64,
}

pub(super) async fn resolve_members(
    session: &impl SlackWorkspaceSession,
    directory: &SlackDirectory,
    channel: &SlackConversationId,
    roster: &[MacroUserIdStr<'static>],
) -> Result<ResolvedMembers, SlackSourceError> {
    let mut resolved = ResolvedMembers {
        participants: Vec::new(),
        member_count: 0,
    };
    let mut seen = HashSet::new();
    let mut cursor = None;
    for _ in 0..MAX_MEMBER_PAGES {
        let page =
            retry_rate_limited(|| session.conversation_members(channel, cursor.as_deref())).await?;
        for id in page.members {
            if !seen.insert(id.clone()) {
                continue;
            }
            let Some(user) = directory
                .0
                .get(&id)
                .filter(|user| !user.is_bot && !user.deleted)
            else {
                continue;
            };
            resolved.member_count += 1;
            if let Some(email) = &user.email
                && roster
                    .iter()
                    .any(|member| member.email_str().eq_ignore_ascii_case(email))
            {
                resolved.participants.push(SlackParticipant {
                    name: user.display_name.clone(),
                    email: Some(email.clone()),
                });
            }
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    Ok(resolved)
}

/// Prefer larger active channels, retaining listing order among ties.
fn select_slack_candidates(
    mut channels: Vec<SlackConversation>,
    cap: usize,
) -> Vec<SlackConversation> {
    channels.retain(|channel| !channel.archived);
    channels.sort_by_key(|channel| std::cmp::Reverse(channel.member_count.unwrap_or(0)));
    channels.truncate(cap);
    channels
}

pub(super) async fn gather_slack<R, S, C, W>(
    service: &ImportServiceImpl<R, S, C, W>,
    user: &MacroUserIdStr<'static>,
    mode: GatherMode,
) -> Result<usize, SlackSourceError>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
    W: SlackWorkspaceSource,
{
    // Anchor before opening/listing: discovery time consumes the enrichment budget.
    // Slack admission before this call does not perform asynchronous work.
    let enrichment_deadline =
        Instant::now() + gather_timeout(ImportSource::Slack, mode) - ENRICHMENT_TIMEOUT_RESERVE;
    let session = service.slack_source.open(user).await?;
    let mut channels = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor = None;
    for _ in 0..MAX_CONVERSATION_PAGES {
        let page = retry_rate_limited(|| session.list_conversations(cursor.as_deref())).await?;
        channels.extend(page.conversations.into_iter().filter(|channel| {
            channel.kind == SlackConversationKind::PublicChannel && seen.insert(channel.id.clone())
        }));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    let initiator = match mode {
        GatherMode::Onboarding => {
            channels = select_slack_candidates(channels, 15);
            Initiator::Onboarding
        }
        GatherMode::Manual => Initiator::Manual,
    };
    let roster = match service
        .repo
        .user_team_id(user)
        .await
        .map_err(|e| SlackSourceError::Other(e.into()))?
    {
        Some(team) => service
            .repo
            .team_members(team)
            .await
            .map_err(|e| SlackSourceError::Other(e.into()))?,
        None => Vec::new(),
    };

    // Make candidates visible before the slower membership reads. Only staged
    // rows are eligible for enrichment; imported/declined rows stay untouched.
    let mut staged = Vec::new();
    for channel in channels {
        let metadata = SlackChannelMeta {
            name: channel.name,
            channel_id: Some(channel.id.as_str().to_string()),
            purpose: channel.purpose,
            participants: Vec::new(),
            member_count: channel.member_count,
            archived: channel.archived,
            members_resolved: false,
        };
        let outcome = service
            .stage_inner(
                user,
                initiator,
                ImportSource::Slack,
                channel.id.as_str(),
                serde_json::to_value(&metadata).map_err(|e| SlackSourceError::Other(e.into()))?,
                false,
            )
            .await;
        match outcome {
            Ok(StageOutcome::Staged(_)) => {
                staged.push((channel.id, metadata));
                if staged.len() % NOTIFY_EVERY == 0 {
                    let _ = timeout_at(enrichment_deadline, service.notify(user)).await;
                }
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(channel = %channel.id.as_str(), error = ?error, "failed to stage Slack channel")
            }
        }
    }
    let _ = timeout_at(enrichment_deadline, service.notify(user)).await;
    let count = staged.len();
    if count == 0 || Instant::now() >= enrichment_deadline {
        return Ok(count);
    }
    let budget = match mode {
        GatherMode::Onboarding => count,
        GatherMode::Manual => MANUAL_MEMBER_BUDGET,
    };
    // Dropping this future stops reads/retries and notifications. Each metadata
    // upsert is atomic and only updates staged rows: cancellation leaves either
    // the original or enriched metadata, never an import claim to clean up.
    match timeout_at(
        enrichment_deadline,
        enrich_slack(service, user, &session, &roster, staged, initiator, budget),
    )
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            tracing::warn!(error = ?error, "Slack enrichment failed; retaining staged channels");
        }
        Err(_) => {
            tracing::warn!("Slack enrichment deadline reached; retaining staged channels");
        }
    }
    Ok(count)
}

async fn enrich_slack<R, S, C, W>(
    service: &ImportServiceImpl<R, S, C, W>,
    user: &MacroUserIdStr<'static>,
    session: &W::Session,
    roster: &[MacroUserIdStr<'static>],
    mut staged: Vec<(SlackConversationId, SlackChannelMeta)>,
    initiator: Initiator,
    budget: usize,
) -> Result<(), SlackSourceError>
where
    R: ImportRepo + CanonicalImportRepo + Clone,
    S: ConnectorSelect,
    C: EntityCreator,
    W: SlackWorkspaceSource,
{
    let directory = match SlackDirectory::load(session).await {
        Ok(directory) => directory,
        Err(error) => {
            tracing::warn!(error = ?error, "Slack directory unavailable; leaving membership unresolved");
            return Ok(());
        }
    };
    staged.sort_by_key(|(_, metadata)| std::cmp::Reverse(metadata.member_count.unwrap_or(0)));
    let mut enriched = 0;
    for (channel, mut metadata) in staged.into_iter().take(budget) {
        let members = match resolve_members(session, &directory, &channel, roster).await {
            Ok(members) => members,
            Err(error) => {
                tracing::warn!(channel = %channel.as_str(), error = ?error, "Slack membership unavailable");
                continue;
            }
        };
        metadata.participants = members.participants;
        metadata.member_count = Some(members.member_count);
        metadata.members_resolved = true;
        match service
            .stage_inner(
                user,
                initiator,
                ImportSource::Slack,
                channel.as_str(),
                serde_json::to_value(metadata).map_err(|e| SlackSourceError::Other(e.into()))?,
                false,
            )
            .await
        {
            Ok(StageOutcome::Staged(_)) => {
                enriched += 1;
                if enriched % NOTIFY_EVERY == 0 {
                    service.notify(user).await;
                }
            }
            // An import or user decision may have won since initial staging.
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(channel = %channel.as_str(), error = ?error, "failed to enrich Slack channel")
            }
        }
    }
    service.notify(user).await;
    Ok(())
}
