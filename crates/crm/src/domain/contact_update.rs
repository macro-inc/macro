//! Narrow contact edits, validated against the locked current record.

use super::{
    generic_email_domains::is_personal_email_domain,
    model::{CrmContact, CrmError},
};

/// One explicit change, preserving identity, history and archive state.
#[derive(Debug)]
pub enum ContactFieldUpdate {
    /// Add a validated, normalized email only when absent.
    Email(String),
    /// Link or switch a personal-email contact to a company in its team.
    Company(uuid::Uuid),
}

impl CrmContact {
    /// Use the same consumer-provider classification as email sync.
    pub fn has_personal_email(&self) -> bool {
        self.email
            .as_deref()
            .and_then(|email| email.split_once('@'))
            .is_some_and(|(_, domain)| is_personal_email_domain(domain))
    }
}

impl ContactFieldUpdate {
    /// Called under the repository's contact lock, after visibility checks.
    pub fn validate(&self, current: &CrmContact) -> Result<(), CrmError> {
        match self {
            Self::Email(email) if current.email.as_deref().is_some_and(|saved| saved != email) => {
                Err(CrmError::InvalidRequest(
                    "an existing contact email cannot be changed".into(),
                ))
            }
            Self::Company(_) if !current.has_personal_email() => Err(CrmError::InvalidRequest(
                "company changes require a personal-provider email".into(),
            )),
            _ => Ok(()),
        }
    }
}
