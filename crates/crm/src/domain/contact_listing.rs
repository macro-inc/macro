//! Viewer-scoped contact listings and their pagination contract.

use filter_ast::Expr;
use item_filters::ast::crm_contact::CrmContactLiteral;
use uuid::Uuid;

use super::companies_repo::{CrmCompanyListSort, CrmCompanySoupCursor};

pub use super::model::CrmContactForSoup;

/// Filtering and ordering applied to an opt-in contact listing.
#[derive(Debug, Clone)]
pub struct CrmContactListQuery {
    /// Predicates over authorized records, evaluated before deduplication.
    pub filter: Expr<CrmContactLiteral>,
    /// Timestamp ordering, using first/last interaction for created/updated sorts.
    pub sort: CrmCompanyListSort,
    /// Seek strictly past this timestamp and record ID after deduplication.
    pub cursor: Option<CrmCompanySoupCursor>,
    /// Whether to sort and seek in ascending order.
    pub ascending: bool,
    /// Maximum records returned, bounded by the domain service.
    pub limit: u16,
}

/// Authorized scope chosen by the CRM service, never by a query filter.
#[derive(Debug)]
pub enum CrmContactListScope<'a> {
    /// Every enabled CRM team the viewer belongs to. Hidden access is
    /// checked separately against the viewer's role on each owning team.
    Viewer(&'a str),
    /// A verified team-scoped bot receipt, restricted to that team's records.
    Team {
        /// Team encoded by the verified receipt.
        team_id: Uuid,
        /// Whether that receipt permits hidden records.
        include_hidden: bool,
    },
}

/// Exact ID hydration keeps each requested team record, even if emails match.
pub fn contact_ids_only(filter: &Expr<CrmContactLiteral>) -> bool {
    match filter {
        Expr::Literal(CrmContactLiteral::Id(_)) => true,
        Expr::Or(a, b) => contact_ids_only(a) && contact_ids_only(b),
        _ => false,
    }
}

/// A query must explicitly address hidden state to include hidden rows.
pub fn contact_hidden_requested(filter: &Expr<CrmContactLiteral>) -> bool {
    match filter {
        Expr::Literal(CrmContactLiteral::Hidden(_)) => true,
        Expr::And(a, b) | Expr::Or(a, b) => {
            contact_hidden_requested(a) || contact_hidden_requested(b)
        }
        Expr::Not(a) => contact_hidden_requested(a),
        _ => false,
    }
}
