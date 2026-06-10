//! Capability tokens for authorized CRM service calls.
//!
//! Each per-entity / per-team CRM service method takes one of these
//! receipt wrappers instead of raw ids. A receipt bundles a verified
//! [`EntityAccessReceipt`] — the capability, mintable only by the
//! `entity_access` trusted seam — with the owning `team_id` the CRM
//! repository scopes its queries by. Holding a receipt is a
//! compile-time proof that the caller passed the access check for the
//! entity it addresses; there is no way to call a per-entity CRM method
//! with a bare UUID.
//!
//! The company / contact / comment receipts are minted by the CRM
//! access extractors in [`crate::inbound::axum_extractors`] via
//! crate-private constructors. [`CrmTeamReceipt::from_team_receipt`] is
//! public because the team receipt it wraps is itself the capability
//! (only `entity_access` can produce one) and the team id is derived
//! from it — there is nothing to forge. The `dangerously_internal`
//! constructors are test-only (`cfg(test)`, crate-private): no production
//! caller can mint a receipt without passing an access check.

use entity_access::domain::models::{
    AccessLevel, EntityAccessReceipt, EntityType, RequiredPermission,
};
use uuid::Uuid;

use crate::domain::{comment::CrmCommentEntityType, model::CrmError};

#[cfg(test)]
mod test;

/// Capability token for a CRM service call addressing a single company.
///
/// `receipt`'s entity is the `CrmCompany`; `team_id` is the owning team,
/// resolved at mint time.
#[derive(Debug)]
pub struct CrmCompanyReceipt<T: RequiredPermission> {
    receipt: EntityAccessReceipt<T>,
    team_id: Uuid,
}

impl<T: RequiredPermission> CrmCompanyReceipt<T> {
    /// Mint a company receipt. Crate-private so only the CRM access
    /// extractors can produce one off a verified access check. Unused
    /// when the extractor seam (`axum`) isn't compiled (e.g. crm pulled
    /// in for `ports` only).
    #[cfg_attr(not(feature = "axum"), allow(dead_code))]
    pub(crate) fn new(receipt: EntityAccessReceipt<T>, team_id: Uuid) -> Self {
        Self { receipt, team_id }
    }

    /// The owning team the repository scopes its query by.
    pub fn team_id(&self) -> Uuid {
        self.team_id
    }

    /// The underlying verified access receipt.
    pub fn receipt(&self) -> &EntityAccessReceipt<T> {
        &self.receipt
    }

    /// The addressed company id. Errors if the receipt is not for a
    /// `CrmCompany` (defensive — the type is only minted for company
    /// receipts) or the id is malformed.
    pub(crate) fn company_id(&self) -> Result<Uuid, CrmError> {
        if self.receipt.entity().entity_type != EntityType::CrmCompany {
            return Err(CrmError::InvalidRequest(
                "receipt is not for a CrmCompany".into(),
            ));
        }
        Uuid::parse_str(&self.receipt.entity().entity_id)
            .map_err(|_| CrmError::InvalidRequest("invalid company id".into()))
    }

    /// Whether the caller's role reveals hidden rows (Edit+).
    pub(crate) fn include_hidden(&self) -> bool {
        self.receipt
            .entity_permission()
            .allows_access_level(AccessLevel::Edit)
    }

    /// Test-only: mints an `Owner` receipt with no access check.
    #[cfg(test)]
    pub(crate) fn dangerously_internal(company_id: Uuid, team_id: Uuid) -> Self {
        Self {
            receipt: EntityAccessReceipt::dangerously_assert_internal_user(
                &company_id.to_string(),
                EntityType::CrmCompany,
            ),
            team_id,
        }
    }
}

/// Capability token for a CRM service call addressing a single contact.
///
/// `receipt`'s entity is the `CrmContact`; `team_id` is the team that
/// owns the contact's parent company, resolved at mint time.
#[derive(Debug)]
pub struct CrmContactReceipt<T: RequiredPermission> {
    receipt: EntityAccessReceipt<T>,
    team_id: Uuid,
}

impl<T: RequiredPermission> CrmContactReceipt<T> {
    /// Mint a contact receipt. Crate-private so only the CRM access
    /// extractors can produce one off a verified access check. Unused
    /// when the extractor seam (`axum`) isn't compiled.
    #[cfg_attr(not(feature = "axum"), allow(dead_code))]
    pub(crate) fn new(receipt: EntityAccessReceipt<T>, team_id: Uuid) -> Self {
        Self { receipt, team_id }
    }

    /// The owning team the repository scopes its query by.
    pub fn team_id(&self) -> Uuid {
        self.team_id
    }

    /// The underlying verified access receipt.
    pub fn receipt(&self) -> &EntityAccessReceipt<T> {
        &self.receipt
    }

    /// The addressed contact id. Errors if the receipt is not for a
    /// `CrmContact` (defensive) or the id is malformed.
    pub(crate) fn contact_id(&self) -> Result<Uuid, CrmError> {
        if self.receipt.entity().entity_type != EntityType::CrmContact {
            return Err(CrmError::InvalidRequest(
                "receipt is not for a CrmContact".into(),
            ));
        }
        Uuid::parse_str(&self.receipt.entity().entity_id)
            .map_err(|_| CrmError::InvalidRequest("invalid contact id".into()))
    }

    /// Whether the caller's role reveals hidden rows (Edit+).
    pub(crate) fn include_hidden(&self) -> bool {
        self.receipt
            .entity_permission()
            .allows_access_level(AccessLevel::Edit)
    }

    /// Test-only: mints an `Owner` receipt with no access check.
    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn dangerously_internal(contact_id: Uuid, team_id: Uuid) -> Self {
        Self {
            receipt: EntityAccessReceipt::dangerously_assert_internal_user(
                &contact_id.to_string(),
                EntityType::CrmContact,
            ),
            team_id,
        }
    }
}

/// Capability token for a team-level CRM service call (e.g. listing the
/// team's companies for the soup feed) that isn't keyed on a single
/// entity.
///
/// `receipt`'s entity is the `Team`; `team_id` equals its entity id.
#[derive(Debug)]
pub struct CrmTeamReceipt<T: RequiredPermission> {
    receipt: EntityAccessReceipt<T>,
    team_id: Uuid,
}

impl<T: RequiredPermission> CrmTeamReceipt<T> {
    /// Mint from a verified team-scoped access receipt (e.g. one
    /// produced by `MacroUserTeamExtractor`). Public because the receipt
    /// is itself the capability and `team_id` is derived from its entity
    /// id, so nothing can be forged. Errors if the receipt is not for a
    /// `Team` or the id is malformed.
    pub fn from_team_receipt(receipt: EntityAccessReceipt<T>) -> Result<Self, CrmError> {
        if receipt.entity().entity_type != EntityType::Team {
            return Err(CrmError::InvalidRequest("receipt is not for a Team".into()));
        }
        let team_id =
            Uuid::parse_str(&receipt.entity().entity_id).map_err(|_| CrmError::InvalidTeamId)?;
        Ok(Self { receipt, team_id })
    }

    /// The team whose records the call addresses.
    pub fn team_id(&self) -> Uuid {
        self.team_id
    }

    /// The underlying verified access receipt.
    pub fn receipt(&self) -> &EntityAccessReceipt<T> {
        &self.receipt
    }

    /// Test-only: mints an `Owner` receipt with no access check.
    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn dangerously_internal(team_id: Uuid) -> Self {
        Self {
            receipt: EntityAccessReceipt::dangerously_assert_internal_user(
                &team_id.to_string(),
                EntityType::Team,
            ),
            team_id,
        }
    }
}

/// Capability token for a CRM comment service call. The `receipt`'s
/// entity is the comment's owning CRM company or contact; `team_id` is
/// the owning team, resolved at mint time.
#[derive(Debug)]
pub struct CrmCommentReceipt<T: RequiredPermission> {
    receipt: EntityAccessReceipt<T>,
    team_id: Uuid,
}

impl<T: RequiredPermission> CrmCommentReceipt<T> {
    /// Mint a comment receipt off a verified access receipt for the
    /// comment's owning entity. Crate-private. Errors if the receipt is
    /// not for a CRM company or contact. Unused when the extractor seam
    /// (`axum`) isn't compiled.
    #[cfg_attr(not(feature = "axum"), allow(dead_code))]
    pub(crate) fn new(receipt: EntityAccessReceipt<T>, team_id: Uuid) -> Result<Self, CrmError> {
        match receipt.entity().entity_type {
            EntityType::CrmCompany | EntityType::CrmContact => Ok(Self { receipt, team_id }),
            _ => Err(CrmError::InvalidRequest(
                "receipt is not for a CrmCompany or CrmContact".into(),
            )),
        }
    }

    /// The owning team the repository scopes its query by.
    pub fn team_id(&self) -> Uuid {
        self.team_id
    }

    /// The underlying verified access receipt.
    pub fn receipt(&self) -> &EntityAccessReceipt<T> {
        &self.receipt
    }

    /// Whether the caller's role reveals comments on hidden parents (Edit+).
    pub(crate) fn include_hidden(&self) -> bool {
        self.receipt
            .entity_permission()
            .allows_access_level(AccessLevel::Edit)
    }

    /// The CRM entity (type + id) the comment hangs off, derived from
    /// the receipt. Used by create / list-threads, which key on the
    /// owning entity rather than a comment id.
    pub(crate) fn comment_entity(&self) -> Result<(CrmCommentEntityType, Uuid), CrmError> {
        let entity_type = match self.receipt.entity().entity_type {
            EntityType::CrmCompany => CrmCommentEntityType::CrmCompany,
            EntityType::CrmContact => CrmCommentEntityType::CrmContact,
            _ => {
                return Err(CrmError::InvalidRequest(
                    "receipt is not for a CrmCompany or CrmContact".into(),
                ));
            }
        };
        let entity_id = Uuid::parse_str(&self.receipt.entity().entity_id)
            .map_err(|_| CrmError::InvalidRequest("invalid entity id".into()))?;
        Ok((entity_type, entity_id))
    }

    /// Test-only: mints an `Owner` receipt with no access check.
    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn dangerously_internal(
        entity_type: CrmCommentEntityType,
        entity_id: Uuid,
        team_id: Uuid,
    ) -> Self {
        let et = match entity_type {
            CrmCommentEntityType::CrmCompany => EntityType::CrmCompany,
            CrmCommentEntityType::CrmContact => EntityType::CrmContact,
        };
        Self {
            receipt: EntityAccessReceipt::dangerously_assert_internal_user(
                &entity_id.to_string(),
                et,
            ),
            team_id,
        }
    }
}
