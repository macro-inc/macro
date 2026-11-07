use std::{fmt, str::FromStr};

use uuid::Uuid;

#[cfg(test)]
mod test;

/// Canonical staging key: `slack-import/{team}/{job}/users.json` or
/// `slack-import/{team}/{job}/{conversation}/{part}.ndjson`.
/// A key's shape is not authorization; callers must resolve it through a manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackImportKey {
    team: Uuid,
    job: Uuid,
    part: Option<(String, u32)>,
}

/// A malformed or noncanonical Slack staging key, without exposing the input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidSlackImportKey;

impl fmt::Display for InvalidSlackImportKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("invalid Slack import key")
    }
}

impl std::error::Error for InvalidSlackImportKey {}

impl SlackImportKey {
    /// Build the normalized users payload key.
    pub fn users(team: Uuid, job: Uuid) -> Result<Self, InvalidSlackImportKey> {
        if team.is_nil() || team.is_max() || job.is_nil() || job.is_max() {
            return Err(InvalidSlackImportKey);
        }
        Ok(Self {
            team,
            job,
            part: None,
        })
    }

    /// Build a zero-based conversation part key, rejecting unsafe/non-Slack IDs.
    pub fn conversation_part(
        team: Uuid,
        job: Uuid,
        conversation: &str,
        part: u32,
    ) -> Result<Self, InvalidSlackImportKey> {
        if !(2..=64).contains(&conversation.len())
            || !matches!(conversation.as_bytes()[0], b'C' | b'G' | b'D')
            || !conversation
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        {
            return Err(InvalidSlackImportKey);
        }
        let mut key = Self::users(team, job)?;
        key.part = Some((conversation.to_owned(), part));
        Ok(key)
    }

    /// Owning Macro team.
    pub fn team(&self) -> Uuid {
        self.team
    }

    /// Owning import job.
    pub fn job(&self) -> Uuid {
        self.job
    }

    /// Conversation identity and index, or `None` for users metadata.
    pub fn part(&self) -> Option<(&str, u32)> {
        self.part.as_ref().map(|(id, index)| (id.as_str(), *index))
    }

    /// Render the canonical S3 key.
    pub fn to_key(&self) -> String {
        self.to_string()
    }

    /// Parse only the exact canonical spelling (no encoding, aliases or padding).
    pub fn from_s3_key(value: &str) -> Result<Self, InvalidSlackImportKey> {
        value.parse()
    }
}

impl fmt::Display for SlackImportKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "slack-import/{}/{}/", self.team, self.job)?;
        match &self.part {
            None => f.write_str("users.json"),
            Some((id, part)) => write!(f, "{id}/{part}.ndjson"),
        }
    }
}

impl FromStr for SlackImportKey {
    type Err = InvalidSlackImportKey;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let segments: Vec<_> = value.split('/').collect();
        let key = match segments.as_slice() {
            ["slack-import", team, job, "users.json"] => Self::users(
                team.parse().map_err(|_| InvalidSlackImportKey)?,
                job.parse().map_err(|_| InvalidSlackImportKey)?,
            )?,
            ["slack-import", team, job, conversation, file] => Self::conversation_part(
                team.parse().map_err(|_| InvalidSlackImportKey)?,
                job.parse().map_err(|_| InvalidSlackImportKey)?,
                conversation,
                file.strip_suffix(".ndjson")
                    .ok_or(InvalidSlackImportKey)?
                    .parse()
                    .map_err(|_| InvalidSlackImportKey)?,
            )?,
            _ => return Err(InvalidSlackImportKey),
        };
        if key.to_string() != value {
            return Err(InvalidSlackImportKey);
        }
        Ok(key)
    }
}
