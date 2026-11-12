use crate::audit::AuditResult;

#[cfg(test)]
mod test;
use std::str::FromStr;

/// Verified Rox account facts accepted for binding. No broker or mailbox credential is present.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedRoxIdentity {
    account_id: String,
    handle: String,
}

impl VerifiedRoxIdentity {
    /// Accept identity facts only after the caller has verified them with the Rox account system.
    pub fn new(
        account_id: impl Into<String>,
        handle: impl Into<String>,
    ) -> crate::domain::Result<Self> {
        let account_id = account_id.into();
        let handle = handle.into();
        if account_id.trim().is_empty() || account_id.trim() != account_id {
            return Err(crate::domain::EnterpriseError::InvalidInput(
                "verified Rox account id must be non-empty and trimmed",
            ));
        }
        if handle.is_empty()
            || handle.trim() != handle
            || handle.contains('@')
            || handle.chars().any(char::is_whitespace)
        {
            return Err(crate::domain::EnterpriseError::InvalidInput(
                "verified Rox handle must be a non-empty local part",
            ));
        }
        Ok(Self { account_id, handle })
    }

    /// Verified Rox account id.
    #[must_use]
    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    /// Verified handle, without `@rox.one`.
    #[must_use]
    pub fn handle(&self) -> &str {
        &self.handle
    }
}

/// Local runtime presets that a team may allow. Cloud runtimes are intentionally absent.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    serde::Serialize,
    serde::Deserialize,
    strum::AsRefStr,
    strum::EnumString,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum RuntimePreset {
    /// OpenCode on a member-managed runtime.
    Opencode,
    /// Claude Code on a member-managed runtime.
    ClaudeCode,
    /// Codex on a member-managed runtime.
    Codex,
    /// OMP on a member-managed runtime.
    Omp,
}

/// A present allowlist is exhaustive. An absent database row is represented by `Option::None`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct RuntimePresetAllowlist {
    /// The only local presets that may start for this team.
    pub preset_ids: Vec<RuntimePreset>,
}

impl Default for RuntimePresetAllowlist {
    fn default() -> Self {
        Self {
            preset_ids: vec![
                RuntimePreset::Opencode,
                RuntimePreset::ClaudeCode,
                RuntimePreset::Codex,
                RuntimePreset::Omp,
            ],
        }
    }
}

impl RuntimePresetAllowlist {
    /// Validate a requested runtime id against this exhaustive list.
    #[must_use]
    pub fn permits(&self, requested: &str) -> bool {
        RuntimePreset::from_str(requested)
            .ok()
            .is_some_and(|preset| self.preset_ids.contains(&preset))
    }
}

/// Honest result of disabling a member: remote mailbox and laptop-file work remain gaps.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct DisableMemberReport {
    /// Always true: `mail.rox.one` has no suspend route in this repository.
    pub mail_suspend_gap: bool,
    /// Always true when local `mhns_` credentials cannot be reached from the server.
    pub harness_revoke_gap: bool,
    /// Server-side harness registrations and their token records revoked by this action.
    pub server_records_revoked: usize,
}

impl DisableMemberReport {
    pub(crate) fn new(server_records_revoked: usize) -> Self {
        Self {
            mail_suspend_gap: true,
            harness_revoke_gap: true,
            server_records_revoked,
        }
    }

    pub(crate) fn audit_result(&self) -> AuditResult {
        AuditResult::MailSuspendGap
    }
}
