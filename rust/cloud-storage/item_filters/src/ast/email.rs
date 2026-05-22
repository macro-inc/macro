use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, email::EmailStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{EmailFilters, SharedEmailFilter, ast::ExpandErr, ast::date::DateLiteral};

/// Possible email values in the ast
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Email {
    /// A string which is not a valid fully qualified email or domain
    Partial(String),
    /// a fully valid qualified [EmailStr]
    Complete(EmailStr<'static>),
    /// a bare domain (e.g. "acme.com"), no local part
    Domain(String),
}

/// Returns true if `s` looks like a bare domain: no `@`, at least two
/// dot-separated segments, each made of alphanumeric or `-` characters.
fn looks_like_domain(s: &str) -> bool {
    if s.is_empty() || s.contains('@') {
        return false;
    }
    let segments: Vec<&str> = s.split('.').collect();
    if segments.len() < 2 {
        return false;
    }
    segments
        .iter()
        .all(|seg| !seg.is_empty() && seg.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

/// The literal type that can appear in the item filter ast
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EmailLiteral {
    /// The sender field of the email
    Sender(Email),
    /// The cc field of the email
    Cc(Email),
    /// The bcc field of the email
    Bcc(Email),
    /// The recipient field of the email
    Recipient(Email),
    /// This value filters by email thread ID
    ThreadId(Uuid),
    /// This value filters by project ID
    ProjectId(String),
    /// This node value filters by email importance. false short-circuits to match nothing.
    Importance(bool),
    /// This node value filters by notification done state for emails.
    NotificationDone(bool),
    /// This node value filters by notification seen state for emails.
    NotificationSeen(bool),
    /// Controls whether shared email threads are included in results.
    Shared(SharedEmailFilter),
    /// When true, only include threads that have at least one message with an
    /// `.ics` calendar attachment (filename or `application/ics` mime type).
    /// When false, no constraint is applied.
    CalendarOnly(bool),
    /// Filter by thread created_at timestamp
    #[serde(rename = "ca")]
    CreatedAt(DateLiteral),
    /// Filter by thread updated_at timestamp (view-dependent field)
    #[serde(rename = "ua")]
    UpdatedAt(DateLiteral),
}

impl ExpandFrame<EmailLiteral> for EmailFilters {
    type Err = ExpandErr;
    fn expand_ast(input: Self) -> Result<Option<filter_ast::Expr<EmailLiteral>>, Self::Err> {
        let EmailFilters {
            senders,
            cc,
            bcc,
            recipients,
            email_thread_ids,
            project_ids,
            importance,
            notification_filters,
            include_labels: _,
            exclude_labels: _,
            shared,
            crm_domains,
            crm_addresses,
            calendar_only,
        } = input;

        // Expand crm_domains / crm_addresses via the shared helper so the
        // raw AST endpoint and the typed POST stay byte-identical. We
        // discard the scope tag here — the tag is stamped onto
        // [`crate::ast::EmailFilterAst`] by the caller
        // ([`crate::ast::EntityFilterAst::new_from_filters`]).
        let crm_node = expand_crm_scope(crm_domains, crm_addresses)?.map(|(tree, _)| tree);

        fn map_email(s: String) -> Email {
            if let Ok(e) = EmailStr::parse_from_str(&s) {
                return Email::Complete(e.into_owned());
            }
            if looks_like_domain(&s) {
                return Email::Domain(s);
            }
            Email::Partial(s)
        }

        let mapped_senders: Vec<Email> = senders.into_iter().map(map_email).collect();
        let mapped_cc: Vec<Email> = cc.into_iter().map(map_email).collect();
        let mapped_bcc: Vec<Email> = bcc.into_iter().map(map_email).collect();
        let mapped_recipients: Vec<Email> = recipients.into_iter().map(map_email).collect();

        let sender_nodes = mapped_senders
            .into_iter()
            .expand(EmailLiteral::Sender, Expr::or);
        let cc_nodes = mapped_cc.into_iter().expand(EmailLiteral::Cc, Expr::or);
        let bcc_nodes = mapped_bcc.into_iter().expand(EmailLiteral::Bcc, Expr::or);
        let recipient_nodes = mapped_recipients
            .into_iter()
            .expand(EmailLiteral::Recipient, Expr::or);

        let thread_id_nodes = email_thread_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(EmailLiteral::ThreadId), Expr::or)?;

        let project_id_nodes = project_ids
            .into_iter()
            .expand(EmailLiteral::ProjectId, Expr::or);

        let importance_node = importance.map(|imp| Expr::Literal(EmailLiteral::Importance(imp)));
        let notification_done_node = notification_filters
            .done
            .map(|done| Expr::Literal(EmailLiteral::NotificationDone(done)));
        let notification_seen_node = notification_filters
            .seen
            .map(|seen| Expr::Literal(EmailLiteral::NotificationSeen(seen)));
        let shared_node = if shared.is_default() {
            None
        } else {
            Some(Expr::Literal(EmailLiteral::Shared(shared)))
        };
        let calendar_only_node = calendar_only
            .filter(|v| *v)
            .map(|v| Expr::Literal(EmailLiteral::CalendarOnly(v)));

        Ok([
            sender_nodes,
            cc_nodes,
            bcc_nodes,
            recipient_nodes,
            thread_id_nodes,
            project_id_nodes,
            importance_node,
            notification_done_node,
            notification_seen_node,
            shared_node,
            crm_node,
            calendar_only_node,
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}

/// Builds an OR-tree over all four address directions for a single [`Email`].
/// Used by `crm_domains` / `crm_addresses` expansion so a single CRM literal
/// matches a thread regardless of which header field the participant appears in.
fn any_direction(e: Email) -> Expr<EmailLiteral> {
    Expr::or(
        Expr::or(
            Expr::Literal(EmailLiteral::Sender(e.clone())),
            Expr::Literal(EmailLiteral::Cc(e.clone())),
        ),
        Expr::or(
            Expr::Literal(EmailLiteral::Bcc(e.clone())),
            Expr::Literal(EmailLiteral::Recipient(e)),
        ),
    )
}

/// Expand the typed `crm_domains` / `crm_addresses` lists into:
///   1. an AST subtree of any-direction OR literals to AND into the
///      email filter, and
///   2. the [`crate::ast::CrmScope`] tag that downstream consumers
///      ([`crate::ast::EmailFilterAst::crm_scope`]) use for
///      authorization + candidate-set widening.
///
/// Returns `Ok(None)` when both lists are empty. Returns
/// [`ExpandErr::CrmDomainsAndAddressesMutuallyExclusive`] when both are
/// non-empty. Each value is validated:
///   * domains — must pass [`looks_like_domain`].
///   * addresses — must parse as a fully-qualified [`EmailStr`].
///
/// Used by both [`EmailFilters::expand_ast`] (typed POST path, scope
/// discarded — see [`crate::ast::EntityFilterAst::new_from_filters`])
/// and the raw AST endpoint's `into_entity_ast` (typed fields alongside
/// the freeform AST).
pub fn expand_crm_scope(
    crm_domains: Vec<String>,
    crm_addresses: Vec<String>,
) -> Result<Option<(Expr<EmailLiteral>, crate::ast::CrmScope)>, ExpandErr> {
    if !crm_domains.is_empty() && !crm_addresses.is_empty() {
        return Err(ExpandErr::CrmDomainsAndAddressesMutuallyExclusive);
    }

    if !crm_domains.is_empty() {
        let lowercased: Vec<String> = crm_domains.into_iter().map(|s| s.to_lowercase()).collect();
        let tree = lowercased
            .iter()
            .map(|d| -> Result<Expr<EmailLiteral>, ExpandErr> {
                if !looks_like_domain(d) {
                    return Err(ExpandErr::InvalidCrmDomain(d.clone()));
                }
                Ok(any_direction(Email::Domain(d.clone())))
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .reduce(Expr::or)
            .expect("non-empty list yields some node");
        Ok(Some((tree, crate::ast::CrmScope::Domains(lowercased))))
    } else if !crm_addresses.is_empty() {
        let lowercased: Vec<String> = crm_addresses
            .into_iter()
            .map(|s| s.to_lowercase())
            .collect();
        let tree = lowercased
            .iter()
            .map(|s| -> Result<Expr<EmailLiteral>, ExpandErr> {
                let parsed = EmailStr::parse_from_str(s)
                    .map_err(|_| ExpandErr::InvalidCrmAddress(s.clone()))?
                    .into_owned();
                Ok(any_direction(Email::Complete(parsed)))
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .reduce(Expr::or)
            .expect("non-empty list yields some node");
        Ok(Some((tree, crate::ast::CrmScope::Addresses(lowercased))))
    } else {
        Ok(None)
    }
}
