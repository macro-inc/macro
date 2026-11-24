//! Adding and removing the domains a company is known by, validated against
//! the locked current record.

#[cfg(test)]
mod test;

use super::model::{CompanyDomainHolder, CrmError};

/// One explicit domain edit. The domain is validated and normalized before it
/// reaches a variant.
#[derive(Debug)]
pub enum CompanyDomainUpdate {
    /// Add a further domain the organization uses. It goes after every domain
    /// the company holds, so the primary domain and the name stay; it becomes
    /// the primary only for a company that has no domain.
    Add(String),
    /// Remove a domain. Contacts, their addresses and mail stay.
    Remove(String),
}

impl CompanyDomainUpdate {
    /// The domain the edit names.
    pub fn domain(&self) -> &str {
        match self {
            Self::Add(domain) | Self::Remove(domain) => domain,
        }
    }
}

/// A company as its domain edit finds it, read under the edit's locks.
#[derive(Debug)]
pub struct LockedCompanyDomains {
    /// The company's domains, primary (oldest) first.
    pub domains: Vec<String>,
    /// Whether the team named the company (`custom_name`), so its name does
    /// not come from its primary domain.
    pub team_named: bool,
    /// Whether the company's mail syncs. With sync off (always so for an
    /// archived company), every one of its domains is kept out of email sync.
    pub email_sync: bool,
    /// For an added domain, the team's other company already tracking it.
    pub holder: Option<CompanyDomainHolder>,
}

/// What a resolved edit writes.
#[derive(Debug, PartialEq, Eq)]
pub enum CompanyDomainEdit {
    /// The company is already in the requested state.
    Unchanged,
    /// Insert the domain after every domain the company holds.
    Insert,
    /// Delete the domain's row.
    Delete {
        /// The company's sync is off, so the removal lets the domain's mail
        /// back into email sync.
        lifts_exclusion: bool,
    },
}

/// Who asks for the edit, as their team role decides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompanyDomainEditor {
    /// A team member.
    Member,
    /// A team admin or owner, who also sees archived companies.
    Admin,
}

impl CompanyDomainUpdate {
    /// Called under the repository's locks, after visibility checks.
    pub fn resolve(
        &self,
        current: &LockedCompanyDomains,
        editor: CompanyDomainEditor,
    ) -> Result<CompanyDomainEdit, CrmError> {
        let holds = current.domains.iter().any(|domain| domain == self.domain());

        match self {
            Self::Add(_) if holds => Ok(CompanyDomainEdit::Unchanged),
            Self::Add(_) => match &current.holder {
                // A member learns that an archived company holds the domain,
                // as company creation tells them, but not which one.
                Some(holder) if holder.hidden && editor == CompanyDomainEditor::Member => {
                    Err(CrmError::CompanyDomainTaken(None))
                }
                Some(holder) => Err(CrmError::CompanyDomainTaken(Some(holder.clone()))),
                None => Ok(CompanyDomainEdit::Insert),
            },
            Self::Remove(_) if !holds => Ok(CompanyDomainEdit::Unchanged),
            Self::Remove(domain) => {
                // Without a name of the team's own, the company is named after
                // its primary domain, so removing that domain would rename it.
                if current.domains.first() == Some(domain) && !current.team_named {
                    return Err(CrmError::InvalidRequest(
                        "this domain names the company; rename the company before removing it"
                            .into(),
                    ));
                }

                // A company whose sync is off keeps its domains out of email
                // sync. Lifting that is an admin's call, as turning sync back
                // on or unblocking a domain is.
                if !current.email_sync && editor == CompanyDomainEditor::Member {
                    return Err(CrmError::CompanyDomainAdminRequired);
                }

                Ok(CompanyDomainEdit::Delete {
                    lifts_exclusion: !current.email_sync,
                })
            }
        }
    }
}
