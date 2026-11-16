//! Narrow contact edits, validated against the locked current record.

#[cfg(test)]
mod test;

use super::{
    generic_email_domains::is_personal_email_domain,
    model::{CrmContact, CrmError},
};

/// One explicit change, preserving identity, history and archive state.
/// Addresses are validated and normalized before they reach a variant.
#[derive(Debug)]
pub enum ContactFieldUpdate {
    /// Make an address the primary, adding it when the contact does not hold it.
    Email(String),
    /// Add a further address; it becomes the primary only when there is none.
    AddEmail(String),
    /// Remove an address. Removing the primary promotes the oldest one left.
    RemoveEmail(String),
    /// Link or switch a personal-email contact to a company in its team.
    Company(uuid::Uuid),
    /// Remove the company link, leaving a contact without a company.
    NoCompany,
}

/// The identity a contact holds once a [`ContactFieldUpdate`] is applied.
#[derive(Debug, PartialEq, Eq)]
pub struct ContactIdentityChange {
    /// The company the contact belongs to afterwards.
    pub company_id: Option<uuid::Uuid>,
    /// The primary address afterwards.
    pub primary: Option<String>,
    /// An address the contact does not hold yet.
    pub added: Option<String>,
    /// An address the contact stops holding.
    pub removed: Option<String>,
}

impl ContactIdentityChange {
    /// Whether the contact already is in the requested state.
    pub fn changes_nothing(&self, current: &CrmContact) -> bool {
        self.company_id == current.company_id
            && self.primary == current.email
            && self.added.is_none()
            && self.removed.is_none()
    }
}

impl CrmContact {
    /// Use the same consumer-provider classification as email sync.
    pub fn has_personal_email(&self) -> bool {
        self.email
            .as_deref()
            .and_then(|email| email.split_once('@'))
            .is_some_and(|(_, domain)| is_personal_email_domain(domain))
    }

    /// A company-domain contact has a company and at least one address on one
    /// of that company's domains. It cannot be unlinked or moved, and the
    /// last such address cannot be removed.
    pub fn is_company_domain(&self) -> bool {
        !self.company_domain_emails.is_empty()
    }
}

impl ContactFieldUpdate {
    /// Called under the repository's contact lock, after visibility checks.
    pub fn resolve(&self, current: &CrmContact) -> Result<ContactIdentityChange, CrmError> {
        let holds = |email: &String| current.emails.contains(email);
        let unchanged = ContactIdentityChange {
            company_id: current.company_id,
            primary: current.email.clone(),
            added: None,
            removed: None,
        };

        match self {
            Self::Email(email) => Ok(ContactIdentityChange {
                primary: Some(email.clone()),
                added: (!holds(email)).then(|| email.clone()),
                ..unchanged
            }),
            Self::AddEmail(email) => Ok(ContactIdentityChange {
                primary: current.email.clone().or_else(|| Some(email.clone())),
                added: (!holds(email)).then(|| email.clone()),
                ..unchanged
            }),
            Self::RemoveEmail(email) if !holds(email) => Ok(unchanged),
            Self::RemoveEmail(email) => {
                if current.company_domain_emails == [email.as_str()] {
                    return Err(CrmError::InvalidRequest(
                        "this address links the contact to its company and cannot be removed"
                            .into(),
                    ));
                }

                // `emails` lists the primary first, then the rest oldest first.
                let primary = if current.email.as_ref() == Some(email) {
                    current.emails.iter().find(|held| *held != email).cloned()
                } else {
                    current.email.clone()
                };

                Ok(ContactIdentityChange {
                    primary,
                    removed: Some(email.clone()),
                    ..unchanged
                })
            }
            Self::Company(_) if !current.has_personal_email() => Err(CrmError::InvalidRequest(
                "company changes require a personal-provider email".into(),
            )),
            Self::Company(company_id) => {
                if current.is_company_domain() && current.company_id != Some(*company_id) {
                    return Err(CrmError::InvalidRequest(
                        "a contact on its company's domain cannot change company".into(),
                    ));
                }

                Ok(ContactIdentityChange {
                    company_id: Some(*company_id),
                    ..unchanged
                })
            }
            Self::NoCompany if current.is_company_domain() => Err(CrmError::InvalidRequest(
                "a contact on its company's domain cannot be unlinked".into(),
            )),
            Self::NoCompany => Ok(ContactIdentityChange {
                company_id: None,
                ..unchanged
            }),
        }
    }
}
