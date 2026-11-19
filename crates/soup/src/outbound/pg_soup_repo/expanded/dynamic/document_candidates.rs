//! The documents a filter can match, when the filter names them.
//!
//! A CRM record's Files tab asks for documents associated with the record
//! (resolved to ids) or uploaded from an email attachment sent by, or to, the
//! record's addresses or domains. Started from the caller's access, that
//! query walks the attachment chain of every document the caller can open.
//! The documents the filter names are far fewer: the ids, and the attachment
//! documents `document_email_participants` lists under the addresses and
//! domains.
//!
//! The candidates only choose where the arm starts ([`CandidateArm`]). The
//! arm still applies the caller's access and the whole filter to every
//! candidate, so a candidate the filter no longer matches drops out, and the
//! projection may hold more than the attachment chain proves, never less.

use filter_ast::Expr;
use item_filters::ast::{document::DocumentLiteral, email::Email};
use uuid::Uuid;

use super::{ALL_DOCUMENTS, DocumentIdArrays, bound_access_semi_join};
use crate::outbound::pg_soup_repo::candidate_gates::PER_CANDIDATE;

#[cfg(test)]
mod test;

/// Where a document arm with [`DocumentCandidates`] starts.
#[derive(Clone, Debug)]
pub(in crate::outbound::pg_soup_repo) enum CandidateArm {
    /// From each candidate, checking its own grants: the cost follows the
    /// candidates alone, however much the caller can access.
    EachCandidate(DocumentCandidates),
    /// From the caller's accessible documents that are also candidates:
    /// Postgres reads both sets once and joins them, so only documents in
    /// both reach the filter. For candidates too many to read one by one.
    WithinAccess(DocumentCandidates),
}

impl CandidateArm {
    /// The arm's `FROM` clause, naming the documents `d`, and the access
    /// conjunct its `WHERE` opens with. The caller's source ids are bound at
    /// `source_ids`, the candidates through `arrays`.
    pub(in crate::outbound::pg_soup_repo) fn render(
        self,
        arrays: &mut DocumentIdArrays,
        source_ids: usize,
    ) -> (String, String) {
        match self {
            Self::EachCandidate(candidates) => (
                candidates.fenced_source(arrays),
                each_candidate_access(source_ids),
            ),
            Self::WithinAccess(candidates) => (
                ALL_DOCUMENTS.to_owned(),
                format!(
                    "d.id IN (\n                    {}\n                )\n                AND {}",
                    candidates.union(arrays),
                    bound_access_semi_join("d.id", "document", source_ids)
                ),
            ),
        }
    }
}

/// Checks one candidate's access: reads the candidate's grants, then matches
/// them against the caller's source ids above an `OFFSET` fence. Matched in
/// the index scan instead, `source_id = ANY(...)` costs one index descent per
/// source id for every candidate on Postgres 14; read whole, a document's few
/// grants are a single descent.
fn each_candidate_access(source_ids: usize) -> String {
    format!(
        r#"EXISTS (
                    SELECT 1 FROM (
                        SELECT ea.source_id FROM entity_access ea
                        WHERE ea.entity_id::text = d.id
                            AND ea.entity_type = 'document'
                        {PER_CANDIDATE}
                    ) grants
                    WHERE grants.source_id = ANY(${source_ids}::text[])
                )"#
    )
}

/// A superset of the documents a filter matches.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(in crate::outbound::pg_soup_repo) struct DocumentCandidates {
    /// Documents named by id.
    pub(in crate::outbound::pg_soup_repo) ids: Vec<Uuid>,
    /// Lowercased domains of attachment participants.
    pub(in crate::outbound::pg_soup_repo) domains: Vec<String>,
    /// Lowercased complete addresses of attachment participants.
    pub(in crate::outbound::pg_soup_repo) addresses: Vec<String>,
}

impl DocumentCandidates {
    /// The candidates of `expr`, whose negations must already sit on its
    /// literals, when it names attachment participants. `None` when some
    /// document it matches may lie outside every set it names (a negated or
    /// unrelated literal on one side of an OR), and when the bound it keeps
    /// names no participant: those filters keep the access-driven arm.
    pub(in crate::outbound::pg_soup_repo) fn of(expr: &Expr<DocumentLiteral>) -> Option<Self> {
        Self::superset(expr).filter(Self::names_participants)
    }

    fn names_participants(&self) -> bool {
        !self.domains.is_empty() || !self.addresses.is_empty()
    }

    /// A superset of what `expr` matches, or `None` when it has none here.
    /// An id names no participant, an `Or` unites its sides and an `And` keeps
    /// the side with fewer, so every filter `super::named_document_bound`
    /// bounds has a superset naming no participant, and no candidates (test
    /// `candidates_never_meet_access_after_filters`).
    fn superset(expr: &Expr<DocumentLiteral>) -> Option<Self> {
        match expr {
            Expr::Literal(literal) => Self::of_literal(literal),
            Expr::Not(_) => None,
            Expr::Or(a, b) => {
                let (mut a, b) = (Self::superset(a)?, Self::superset(b)?);
                a.ids.extend(b.ids);
                a.domains.extend(b.domains);
                a.addresses.extend(b.addresses);
                Some(a)
            }
            // Either side bounds the conjunction; prefer the one that names
            // fewer participants, whose projection reads are the cost.
            Expr::And(a, b) => match (Self::superset(a), Self::superset(b)) {
                (Some(a), Some(b)) => Some(if b.participant_count() < a.participant_count() {
                    b
                } else {
                    a
                }),
                (a, b) => a.or(b),
            },
        }
    }

    fn of_literal(literal: &DocumentLiteral) -> Option<Self> {
        match literal {
            DocumentLiteral::Id(id) => Some(Self {
                ids: vec![*id],
                ..Self::default()
            }),
            DocumentLiteral::EmailAttachmentParticipant(Email::Domain(domain)) => Some(Self {
                domains: vec![domain.to_lowercase()],
                ..Self::default()
            }),
            DocumentLiteral::EmailAttachmentParticipant(Email::Complete(address)) => Some(Self {
                addresses: vec![address.0.as_ref().to_lowercase()],
                ..Self::default()
            }),
            // Rendered as FALSE: an unresolved association matches nothing.
            DocumentLiteral::CrmAssociated(_) => Some(Self::default()),
            _ => None,
        }
    }

    fn participant_count(&self) -> usize {
        self.domains.len() + self.addresses.len()
    }

    /// [`CandidateArm::EachCandidate`]'s `FROM` clause: the distinct
    /// candidates, collected behind an `OFFSET` fence before any document is
    /// read, joined to `"Document" d`. A single set has no `UNION` to remove
    /// a document listed under two of its participants.
    fn fenced_source(self, arrays: &mut DocumentIdArrays) -> String {
        format!(
            r#"FROM (
                    SELECT DISTINCT candidates.id FROM (
                        {}
                    ) candidates
                    {PER_CANDIDATE}
                ) candidates
                JOIN "Document" d ON d.id = candidates.id"#,
            self.union(arrays)
        )
    }

    /// The candidate ids, as a `UNION` of the ids and the participant rows.
    /// Addresses are matched under their own domain, the index's first
    /// column, which Postgres derives from the bound address.
    fn union(self, arrays: &mut DocumentIdArrays) -> String {
        let mut sets = Vec::with_capacity(3);
        if !self.ids.is_empty() {
            let ids = arrays.bind_text_array(self.ids.iter().map(Uuid::to_string).collect());
            sets.push(format!("SELECT unnest({ids}) AS id"));
        }
        if !self.domains.is_empty() {
            let domains = arrays.bind_text_array(self.domains);
            sets.push(format!(
                "SELECT p.document_id AS id FROM document_email_participants p
                        WHERE split_part(p.address, '@', 2) = ANY({domains})"
            ));
        }
        if !self.addresses.is_empty() {
            let addresses = arrays.bind_text_array(self.addresses);
            sets.push(format!(
                "SELECT p.document_id AS id FROM unnest({addresses}) a(address)
                        JOIN document_email_participants p
                            ON split_part(p.address, '@', 2) = split_part(a.address, '@', 2)
                            AND p.address = a.address"
            ));
        }
        sets.join("\n                        UNION ")
    }
}
