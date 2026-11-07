//! Domain exclusion policy, shared by explicit blocklists and company exclusions.

use super::EmailBlockScope;
use crate::domain::{
    generic_email_domains::is_personal_email_domain,
    model::{CrmError, MailboxDomainConflict},
};
use std::collections::BTreeMap;

#[cfg(test)]
mod test;

/// Only the facts needed by the guard; never includes a mailbox address.
pub(crate) struct ConnectedMailboxDomain {
    pub domain: String,
    pub is_caller: bool,
}

pub(crate) fn conflict(
    domain: &str,
    scope: EmailBlockScope,
    mailboxes: &[ConnectedMailboxDomain],
) -> Option<MailboxDomainConflict> {
    let domain = domain.to_ascii_lowercase();
    let suffix = format!(".{domain}");
    let mut personal_provider = false;
    for mailbox in mailboxes {
        if scope == EmailBlockScope::Personal && !mailbox.is_caller {
            continue;
        }
        // Match crm_email_domain_blocked: an entry covers itself and child
        // domains, never its parent or a domain with only a textual suffix.
        let mailbox_domain = mailbox.domain.to_ascii_lowercase();
        if mailbox_domain != domain && !mailbox_domain.ends_with(&suffix) {
            continue;
        }
        if !is_personal_email_domain(&mailbox_domain) {
            return Some(MailboxDomainConflict::Company);
        }
        personal_provider = true;
    }
    personal_provider.then_some(MailboxDomainConflict::PersonalProvider)
}

pub(crate) fn validate(
    domain: &str,
    scope: EmailBlockScope,
    mailboxes: &[ConnectedMailboxDomain],
) -> Result<(), CrmError> {
    if let Some(reason) = conflict(domain, scope, mailboxes) {
        return Err(CrmError::BlocksConnectedMailbox(reason));
    }
    Ok(())
}

pub(crate) fn warnings(
    domains: &[String],
    scope: EmailBlockScope,
    mailboxes: &[ConnectedMailboxDomain],
) -> BTreeMap<String, MailboxDomainConflict> {
    domains
        .iter()
        .filter_map(|domain| {
            conflict(domain, scope, mailboxes).map(|reason| (domain.clone(), reason))
        })
        .collect()
}
