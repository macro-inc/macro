//! The CRM records an associated-items query matches against.

use uuid::Uuid;

pub use item_filters::ast::crm_association::CrmAssociation;

/// The records whose Companies and Contacts property values, and whose
/// references, make an item associated with an authorized CRM record.
///
/// A company covers itself and every contact of the company that the viewer
/// may see. A contact covers only itself: it does not inherit the items
/// associated with its company.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CrmRecordAssociation {
    /// Companies matched through the Companies property or a reference.
    pub company_ids: Vec<Uuid>,
    /// Contacts matched through the Contacts property or a reference.
    pub contact_ids: Vec<Uuid>,
    /// Normalized domains of visible companies, for activity email matching.
    pub domains: Vec<String>,
    /// Normalized addresses of visible contacts, for activity email matching.
    pub addresses: Vec<String>,
}

impl CrmRecordAssociation {
    /// The association of a company and its visible contacts.
    pub fn company(company_id: Uuid, contact_ids: Vec<Uuid>) -> Self {
        Self {
            company_ids: vec![company_id],
            contact_ids,
            domains: Vec::new(),
            addresses: Vec::new(),
        }
    }

    /// The association of one contact.
    pub fn contact(contact_id: Uuid) -> Self {
        Self {
            company_ids: Vec::new(),
            contact_ids: vec![contact_id],
            domains: Vec::new(),
            addresses: Vec::new(),
        }
    }
}
