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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PhoneSource {
    /// Typed on the contact.
    Manual,
    /// A CSV import.
    Csv,
    /// A Dialpad call whose contact matched by email.
    Dialpad,
}

impl PhoneSource {
    /// The stored value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Csv => "csv",
            Self::Dialpad => "dialpad",
        }
    }
}

impl std::str::FromStr for PhoneSource {
    type Err = CrmError;

    fn from_str(stored: &str) -> Result<Self, Self::Err> {
        match stored {
            "manual" => Ok(Self::Manual),
            "csv" => Ok(Self::Csv),
            "dialpad" => Ok(Self::Dialpad),
            other => Err(CrmError::StorageLayerError(anyhow::anyhow!(
                "unknown phone source {other}"
            ))),
        }
    }
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

/// Parse numbers a person typed, in order, dropping repeats. The error names
/// the first value that is not a number with its country code.
pub fn parse_contact_phones(phones: &[String]) -> Result<Vec<PhoneNumber>, CrmError> {
    let mut parsed: Vec<PhoneNumber> = Vec::new();
    for text in phones {
        let phone = PhoneNumber::parse(text).ok_or_else(|| {
            CrmError::InvalidRequest(format!(
                "{} is not a phone number with its country code, starting with +",
                text.trim()
            ))
        })?;
        if !parsed.contains(&phone) {
            parsed.push(phone);
        }
    }
    if parsed.len() > MAX_CONTACT_PHONES {
        return Err(CrmError::InvalidRequest(format!(
            "A contact holds at most {MAX_CONTACT_PHONES} phone numbers."
        )));
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
