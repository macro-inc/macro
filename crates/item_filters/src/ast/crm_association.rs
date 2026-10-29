//! A CRM record whose associated items a query is restricted to.
//!
//! An item is associated with a company when its Companies property names
//! the company, its Contacts property names one of the company's contacts,
//! or it references the company or one of those contacts. An item is
//! associated with a contact when its Contacts property names the contact
//! or it references the contact. Activity instead matches properties across
//! visible, CRM-enabled teams and email participants from their domains and
//! addresses. The Soup domain authorizes the record and
//! resolves that membership before any source query runs; renderers never
//! evaluate these values themselves.

use filter_ast::Expr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::ast::document::DocumentLiteral;

/// The CRM record an association filter names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum CrmAssociation {
    /// Items associated with the company or with any of its contacts.
    Company(Uuid),
    /// Items associated with the contact.
    Contact(Uuid),
    /// Activity across visible CRM-enabled teams, excluding hidden records.
    Activity,
}

/// Every distinct CRM record a document tree names through
/// [`DocumentLiteral::CrmAssociated`], in first-seen order.
pub fn document_crm_associations(expr: &Expr<DocumentLiteral>, out: &mut Vec<CrmAssociation>) {
    match expr {
        Expr::Literal(DocumentLiteral::CrmAssociated(record)) => {
            if !out.contains(record) {
                out.push(*record);
            }
        }
        Expr::Literal(_) => {}
        Expr::And(a, b) | Expr::Or(a, b) => {
            document_crm_associations(a, out);
            document_crm_associations(b, out);
        }
        Expr::Not(a) => document_crm_associations(a, out),
    }
}
