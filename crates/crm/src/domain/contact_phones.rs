//! A CRM contact's phone numbers: shown and called from the contact, and
//! matched against the people on imported phone calls.

use std::future::Future;

use phone_number::PhoneNumber;
use serde::Serialize;
use uuid::Uuid;

use super::model::CrmError;

/// Most numbers one contact holds.
pub const MAX_CONTACT_PHONES: usize = 10;

/// Where a contact's number came from.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PhoneSource {
    /// Typed on the contact.
    Manual,
    /// A CSV import.
    Csv,
    /// A call whose guest matched the contact by email.
    Call,
}

/// One of a contact's numbers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct ContactPhone {
    /// E.164: `+`, the country code and the number.
    #[schema(value_type = String)]
    pub phone: PhoneNumber,
    /// Where the number came from.
    pub source: PhoneSource,
}

/// Parse numbers a person typed, in order, dropping repeats. The error says
/// which entry is not a number with its country code, by position: the value
/// itself is personal data and errors are recorded on spans.
pub fn parse_contact_phones(phones: &[String]) -> Result<Vec<PhoneNumber>, CrmError> {
    let mut parsed: Vec<PhoneNumber> = Vec::new();
    for (index, text) in phones.iter().enumerate() {
        let phone = PhoneNumber::parse(text).ok_or_else(|| {
            CrmError::InvalidRequest(format!(
                "Phone number {} is not a number with its country code, starting with +",
                index + 1
            ))
        })?;
        if parsed.contains(&phone) {
            continue;
        }
        // Checked as numbers arrive, so a huge request costs no more than a full one.
        if parsed.len() == MAX_CONTACT_PHONES {
            return Err(CrmError::InvalidRequest(format!(
                "A contact holds at most {MAX_CONTACT_PHONES} phone numbers."
            )));
        }
        parsed.push(phone);
    }
    Ok(parsed)
}

/// Contact phone storage, scoped to the owning team like the contact itself.
pub trait ContactPhonesRepository: Send + Sync + 'static {
    /// The contact's numbers, oldest first; `None` when the team cannot see
    /// the contact (hidden ones need `include_hidden`).
    fn contact_phones(
        &self,
        team_id: &Uuid,
        contact_id: &Uuid,
        include_hidden: bool,
    ) -> impl Future<Output = Result<Option<Vec<ContactPhone>>, CrmError>> + Send;

    /// Replace the contact's numbers with `phones`. Numbers it keeps keep
    /// their source; new ones are [`PhoneSource::Manual`].
    fn set_contact_phones(
        &self,
        team_id: &Uuid,
        contact_id: &Uuid,
        phones: &[PhoneNumber],
        include_hidden: bool,
    ) -> impl Future<Output = Result<Option<Vec<ContactPhone>>, CrmError>> + Send;

    /// Add numbers from `source` to the team's contacts, keeping any already
    /// there. Contacts outside the team are skipped. Returns how many were new.
    fn add_contact_phones(
        &self,
        team_id: &Uuid,
        phones: &[(Uuid, PhoneNumber)],
        source: PhoneSource,
    ) -> impl Future<Output = Result<u64, CrmError>> + Send;
}

#[cfg(test)]
mod test;
