use super::{Authority, Journal, JournalEntry, MacroUserIdStr, ReadError, Scope, Uuid};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SignedScope {
    pub(super) viewer: Uuid,
    pub(super) team: Uuid,
    pub(super) agent: Uuid,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Profile {
    pub(super) name: String,
    pub(super) role: String,
    pub(super) team_name: String,
    pub(super) lifecycle: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(super) enum Activity {
    Ready { completed: Vec<JournalEntry> },
    Unavailable,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BrainRead {
    pub(super) scope: SignedScope,
    pub(super) profile: Profile,
    pub(super) journal: Activity,
}

pub(super) trait SignedAuthority: Authority {
    fn can_read_team(
        &self,
        viewer: &MacroUserIdStr<'static>,
        team: Uuid,
    ) -> impl Future<Output = Result<bool, ReadError>> + Send;

    fn human_key(
        &self,
        viewer: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<Uuid>, ReadError>> + Send;

    fn active_agent_key(
        &self,
        key: Uuid,
        team: Uuid,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>, ReadError>> + Send;

    fn profile(
        &self,
        scope: &Scope,
    ) -> impl Future<Output = Result<Option<Profile>, ReadError>> + Send;
}

pub(super) struct SignedRead<A> {
    pub(super) authority: A,
    pub(super) allowed_team: Uuid,
    pub(super) journal: Option<(Scope, Journal)>,
}

impl<A: SignedAuthority> SignedRead<A> {
    pub(super) async fn read(
        &self,
        viewer: &MacroUserIdStr<'static>,
        team: Uuid,
        agent_key: Uuid,
    ) -> Result<BrainRead, ReadError> {
        if team != self.allowed_team || !self.authority.can_read_team(viewer, team).await? {
            return Err(ReadError::Unavailable);
        }

        let viewer_key = self
            .authority
            .human_key(viewer)
            .await?
            .ok_or(ReadError::Unavailable)?;
        let agent = self
            .authority
            .active_agent_key(agent_key, team)
            .await?
            .ok_or(ReadError::Unavailable)?;
        let scope = Scope { team, agent };

        let profile = self
            .authority
            .profile(&scope)
            .await?
            .ok_or(ReadError::Unavailable)?;
        let journal = match &self.journal {
            Some((covered, journal)) if covered == &scope => Activity::Ready {
                completed: journal
                    .read(&self.authority, viewer, &scope)
                    .await?
                    .completed,
            },
            _ => Activity::Unavailable,
        };

        // Discard data if any authority used to start the read changed.
        if self.authority.human_key(viewer).await? != Some(viewer_key)
            || self
                .authority
                .active_agent_key(agent_key, team)
                .await?
                .as_ref()
                != Some(&scope.agent)
            || !self.authority.can_read_team(viewer, team).await?
        {
            return Err(ReadError::Unavailable);
        }

        Ok(BrainRead {
            scope: SignedScope {
                viewer: viewer_key,
                team,
                agent: agent_key,
            },
            profile,
            journal,
        })
    }
}
