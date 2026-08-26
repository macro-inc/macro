use super::SqlFragment;
use super::resolve::ResolvedFilters;
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use filter_ast::Expr;
use item_filters::ast::date::DateLiteral;
use item_filters::ast::email::{Email, EmailLiteral};
use item_filters::ast::properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue};
use recursion::CollapsibleExt;
use uuid::Uuid;

fn date_predicate(col: &str, lit: &DateLiteral) -> SqlFragment {
    let sql = match lit {
        DateLiteral::GreaterThan(dt) => {
            format!("{col} > '{}'::timestamptz", dt.to_rfc3339())
        }
        DateLiteral::LessThan(dt) => {
            format!("{col} < '{}'::timestamptz", dt.to_rfc3339())
        }
        DateLiteral::GreaterThanOrEqual(dt) => {
            format!("{col} >= '{}'::timestamptz", dt.to_rfc3339())
        }
        DateLiteral::LessThanOrEqual(dt) => {
            format!("{col} <= '{}'::timestamptz", dt.to_rfc3339())
        }
    };
    SqlFragment::raw(sql)
}

pub(super) fn has_thread_literals(ast: &Expr<EmailLiteral>) -> bool {
    ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a || b,
        filter_ast::ExprFrame::Not(a) => a,
        filter_ast::ExprFrame::Literal(
            EmailLiteral::ThreadId(_)
            | EmailLiteral::Owner(_)
            | EmailLiteral::ProjectId(_)
            | EmailLiteral::CalendarOnly(_)
            | EmailLiteral::Importance(_)
            | EmailLiteral::NotificationSeen(_)
            | EmailLiteral::NotificationDone(_)
            | EmailLiteral::CreatedAt(_)
            | EmailLiteral::UpdatedAt(_)
            | EmailLiteral::Property(_),
        ) => true,
        filter_ast::ExprFrame::Literal(EmailLiteral::Shared(_)) => false,
        filter_ast::ExprFrame::Literal(_) => false,
    })
}

pub(super) fn has_message_literals(ast: &Expr<EmailLiteral>) -> bool {
    ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a || b,
        filter_ast::ExprFrame::Not(a) => a,
        filter_ast::ExprFrame::Literal(
            EmailLiteral::ThreadId(_)
            | EmailLiteral::Owner(_)
            | EmailLiteral::ProjectId(_)
            | EmailLiteral::Shared(_)
            | EmailLiteral::CalendarOnly(_)
            | EmailLiteral::Importance(_)
            | EmailLiteral::NotificationSeen(_)
            | EmailLiteral::NotificationDone(_)
            | EmailLiteral::CreatedAt(_)
            | EmailLiteral::UpdatedAt(_)
            | EmailLiteral::Property(_),
        ) => false,
        filter_ast::ExprFrame::Literal(_) => true,
    })
}

#[derive(Clone, Copy)]
enum AddressKind {
    Sender,
    Cc,
    Bcc,
    Recipient,
}

impl AddressKind {
    fn recipient_type_sql(self) -> Option<&'static str> {
        match self {
            AddressKind::Sender => None,
            AddressKind::Cc => Some("CC"),
            AddressKind::Bcc => Some("BCC"),
            AddressKind::Recipient => Some("TO"),
        }
    }
}

/// Builds a per-message predicate for one address literal, picking the fast
/// path (`m.from_contact_id = $id` / `mr.contact_id = $id`) when the email
/// resolved to a contact id, the LOWER/ILIKE fallback when it's Partial, and
/// `FALSE` when a Complete email has no contact in this link (so any branch
/// referencing it can never match).
fn build_address_predicate_on_m(
    kind: AddressKind,
    email: &Email,
    resolved: &ResolvedFilters,
) -> SqlFragment {
    match (resolved.contact_ids_for(email), email) {
        (Some(contact_ids), _) => match kind {
            AddressKind::Sender => {
                let mut f = SqlFragment::raw("m.from_contact_id = ANY(");
                f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
                f.push_raw(")");
                f
            }
            _ => {
                let recipient_type = kind.recipient_type_sql().expect("non-sender kind");
                let mut f = SqlFragment::raw(format!(
                    r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = '{recipient_type}'
                    AND mr.contact_id = ANY("#,
                ));
                f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
                f.push_raw(")\n                )");
                f
            }
        },
        (None, Email::Complete(_)) => SqlFragment::raw("FALSE"),
        // Partial: substring match against the full address text. Used for
        // fuzzy "type a fragment" lookups (e.g. searching "jo" → "john@..."
        // and "joe@..."). Rides the trigram index on email_address.
        (None, Email::Partial(s)) => {
            let pattern = format!("%{}%", escape_like_pattern(s));
            build_address_text_match(kind, "c.email_address ILIKE ", pattern)
        }
        // Domain: exact match on the domain portion of the address. Backed
        // by the expression index on `LOWER(SPLIT_PART(email_address, '@', 2))`
        // so the lookup is an index seek rather than a trigram substring
        // scan, and there are no false positives like `macro.community`
        // matching the domain `macro.com`.
        (None, Email::Domain(s)) => {
            let domain = s.to_ascii_lowercase();
            build_address_text_match(
                kind,
                "LOWER(SPLIT_PART(c.email_address, '@', 2)) = ",
                domain,
            )
        }
    }
}

/// Shared shape for "join `email_contacts`, apply a single bound predicate
/// against `c.*`". `predicate_prefix` is the SQL up to the bind site
/// (e.g. `"c.email_address ILIKE "`), and `bind_value` is the string that
/// gets bound at that position.
fn build_address_text_match(
    kind: AddressKind,
    predicate_prefix: &str,
    bind_value: String,
) -> SqlFragment {
    match kind {
        AddressKind::Sender => {
            let mut f = SqlFragment::raw(format!(
                r#"EXISTS (
                    SELECT 1 FROM email_contacts c
                    WHERE c.id = m.from_contact_id
                    AND {predicate_prefix}"#
            ));
            f.extend(SqlFragment::bind_string(bind_value));
            f.push_raw("\n                )");
            f
        }
        _ => {
            let recipient_type = kind.recipient_type_sql().expect("non-sender kind");
            let mut f = SqlFragment::raw(format!(
                r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = '{recipient_type}'
                    AND {predicate_prefix}"#,
            ));
            f.extend(SqlFragment::bind_string(bind_value));
            f.push_raw("\n                )");
            f
        }
    }
}

pub(super) fn build_message_email_filter(
    ast: &Expr<EmailLiteral>,
    resolved: &ResolvedFilters,
) -> SqlFragment {
    let fragment = ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => SqlFragment::and(a, b),
        filter_ast::ExprFrame::Or(a, b) => SqlFragment::or(a, b),
        filter_ast::ExprFrame::Not(a) => SqlFragment::not(a),

        filter_ast::ExprFrame::Literal(
            EmailLiteral::ThreadId(_) | EmailLiteral::Owner(_) | EmailLiteral::ProjectId(_),
        ) => SqlFragment::raw("TRUE"),

        filter_ast::ExprFrame::Literal(EmailLiteral::Sender(email)) => {
            build_address_predicate_on_m(AddressKind::Sender, &email, resolved)
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::Recipient(email)) => {
            build_address_predicate_on_m(AddressKind::Recipient, &email, resolved)
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::Cc(email)) => {
            build_address_predicate_on_m(AddressKind::Cc, &email, resolved)
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::Bcc(email)) => {
            build_address_predicate_on_m(AddressKind::Bcc, &email, resolved)
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::Importance(_)) => SqlFragment::raw("TRUE"),
        filter_ast::ExprFrame::Literal(EmailLiteral::NotificationDone(_)) => {
            SqlFragment::raw("TRUE")
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::NotificationSeen(_)) => {
            SqlFragment::raw("TRUE")
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::Shared(_)) => SqlFragment::raw("TRUE"),
        filter_ast::ExprFrame::Literal(EmailLiteral::CalendarOnly(_)) => SqlFragment::raw("TRUE"),
        filter_ast::ExprFrame::Literal(EmailLiteral::CreatedAt(_)) => SqlFragment::raw("TRUE"),
        filter_ast::ExprFrame::Literal(EmailLiteral::UpdatedAt(_)) => SqlFragment::raw("TRUE"),
        filter_ast::ExprFrame::Literal(EmailLiteral::Property(_)) => SqlFragment::raw("TRUE"),
    });

    fragment.with_and_prefix()
}

/// True if the AST contains any address-typed literal (Sender/Cc/Bcc/Recipient).
pub(super) fn has_address_literals(ast: &Expr<EmailLiteral>) -> bool {
    ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a || b,
        filter_ast::ExprFrame::Not(a) => a,
        filter_ast::ExprFrame::Literal(
            EmailLiteral::Sender(_)
            | EmailLiteral::Cc(_)
            | EmailLiteral::Bcc(_)
            | EmailLiteral::Recipient(_),
        ) => true,
        filter_ast::ExprFrame::Literal(_) => false,
    })
}

/// True if the subtree contains only address literals (Sender/Cc/Bcc/Recipient)
/// composed via And/Or/Not. Used to decide whether a top-level conjunct can be
/// safely pushed into the candidate-thread pre-filter without risking false
/// negatives (e.g., `Sender(X) OR CalendarOnly(true)` cannot be reduced to just
/// `Sender(X)` at the candidate stage).
fn is_pure_address_subtree(expr: &Expr<EmailLiteral>) -> bool {
    expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a && b,
        filter_ast::ExprFrame::Not(a) => a,
        filter_ast::ExprFrame::Literal(
            EmailLiteral::Sender(_)
            | EmailLiteral::Cc(_)
            | EmailLiteral::Bcc(_)
            | EmailLiteral::Recipient(_),
        ) => true,
        filter_ast::ExprFrame::Literal(_) => false,
    })
}

/// Walks the top-level AND-chain and returns subtrees that are pure-address.
/// Non-pure subtrees (e.g. `Or(Sender, Importance)`) are skipped because pushing
/// them into the candidate-thread filter would change semantics.
fn extract_address_only_conjuncts(expr: &Expr<EmailLiteral>) -> Vec<&Expr<EmailLiteral>> {
    fn walk<'a>(e: &'a Expr<EmailLiteral>, out: &mut Vec<&'a Expr<EmailLiteral>>) {
        match e {
            Expr::And(a, b) => {
                walk(a, out);
                walk(b, out);
            }
            other => {
                if is_pure_address_subtree(other) {
                    out.push(other);
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(expr, &mut out);
    out
}

/// Builds the per-message address predicate over the same `m` aliases the
/// LATERAL uses, with resolved contact ids substituted in. Caller guarantees
/// the input is a pure-address subtree.
fn build_address_message_predicate(
    expr: &Expr<EmailLiteral>,
    resolved: &ResolvedFilters,
) -> SqlFragment {
    expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => SqlFragment::and(a, b),
        filter_ast::ExprFrame::Or(a, b) => SqlFragment::or(a, b),
        filter_ast::ExprFrame::Not(a) => SqlFragment::not(a),

        filter_ast::ExprFrame::Literal(EmailLiteral::Sender(email)) => {
            build_address_predicate_on_m(AddressKind::Sender, &email, resolved)
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::Recipient(email)) => {
            build_address_predicate_on_m(AddressKind::Recipient, &email, resolved)
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::Cc(email)) => {
            build_address_predicate_on_m(AddressKind::Cc, &email, resolved)
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::Bcc(email)) => {
            build_address_predicate_on_m(AddressKind::Bcc, &email, resolved)
        }

        filter_ast::ExprFrame::Literal(_) => SqlFragment::raw("TRUE"),
    })
}

/// Builds the `NOT EXISTS (… TRASH …)` fragment used inside the candidate
/// subquery. Uses `ml.label_id = ANY($trash_label_ids)` so the probe
/// excludes TRASH messages across every link in scope (one link for
/// per-mailbox queries, all team links for team-scoped queries).
/// Returns `TRUE` (no exclusion) when no in-scope link has a TRASH label —
/// callers must always pre-resolve via `resolve_filters`, and an empty set
/// means no message can be trashed in the first place.
fn build_trash_check(resolved: &ResolvedFilters) -> SqlFragment {
    let ids = resolved.trash_label_ids();
    if ids.is_empty() {
        return SqlFragment::raw("TRUE");
    }
    let mut f = SqlFragment::raw(
        r#"NOT EXISTS (
                  SELECT 1 FROM email_message_labels ml
                  WHERE ml.message_id = m.id AND ml.label_id = ANY("#,
    );
    f.extend(SqlFragment::bind_uuid_array(ids.to_vec()));
    f.push_raw(
        r#")
              )"#,
    );
    f
}

/// True when the AST contains at least one pure-address top-level
/// AND-conjunct, i.e. the candidate WHERE will reference `matching_threads`.
/// Callers use this to decide whether to emit the CTE definition.
pub(super) fn wants_address_pushdown(ast: &Expr<EmailLiteral>) -> bool {
    !extract_address_only_conjuncts(ast).is_empty()
}

/// Emits the `AND t.id IN (SELECT thread_id FROM matching_threads)` fragment
/// pushed into the candidate-thread WHERE. The CTE itself is built by
/// `build_matching_threads_ctes` and pasted into the top-level `WITH …`
/// chain. Returns empty when there are no pure-address conjuncts to push.
pub(super) fn build_thread_address_filter(ast: &Expr<EmailLiteral>) -> SqlFragment {
    if !wants_address_pushdown(ast) {
        return SqlFragment::empty();
    }
    SqlFragment::raw(" AND t.id IN (SELECT thread_id FROM matching_threads)")
}

/// True when the candidate WHERE must mirror the CROSS JOIN LATERAL's
/// message match via a correlated EXISTS rather than the address-only
/// `matching_threads` CTE. That's the case when the lateral applies a
/// per-message filter the address CTE doesn't model — a non-empty
/// view-level message filter (Starred / Drafts / Important / …). Without
/// this, the candidate `LIMIT` counts threads that the lateral later
/// drops, so the page under-fills while still emitting a cursor.
pub(super) fn wants_message_exists_pushdown(view: &PreviewView) -> bool {
    !build_view_message_filter(view).is_empty()
}

/// Builds the candidate-stage mirror of the lateral message match:
/// `AND EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = t.id AND <lateral predicate>)`.
/// The predicate is the same trash exclusion + view message filter +
/// message-level email filter the lateral applies, so a thread enters the
/// candidate set iff it has a message the lateral will surface — making the
/// `LIMIT` count real results.
pub(super) fn build_thread_message_exists_filter(
    ast: &Expr<EmailLiteral>,
    view: &PreviewView,
    resolved: &ResolvedFilters,
) -> SqlFragment {
    let mut f = SqlFragment::raw(
        " AND EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = t.id AND ",
    );
    f.extend(build_lateral_trash_exclusion(resolved));
    let view_message_filter = build_view_message_filter(view);
    if !view_message_filter.is_empty() {
        f.extend(view_message_filter);
    }
    if has_message_literals(ast) {
        f.extend(build_message_email_filter(ast, resolved));
    }
    f.push_raw(")");
    f
}

/// If `expr` is a flat OR-tree (no AND, no NOT) of single positive
/// address literals, returns the list of `(kind, email)` leaves. Otherwise
/// `None` — caller must use the combined-predicate path. UNION-of-branches
/// is only correct for OR-trees: each branch contributes thread_ids
/// independently and the union of branches matches the OR semantics.
fn flatten_or_tree_of_address_literals(
    expr: &Expr<EmailLiteral>,
) -> Option<Vec<(AddressKind, &Email)>> {
    fn walk<'a>(e: &'a Expr<EmailLiteral>, out: &mut Vec<(AddressKind, &'a Email)>) -> bool {
        match e {
            Expr::Or(a, b) => walk(a, out) && walk(b, out),
            Expr::Literal(EmailLiteral::Sender(email)) => {
                out.push((AddressKind::Sender, email));
                true
            }
            Expr::Literal(EmailLiteral::Cc(email)) => {
                out.push((AddressKind::Cc, email));
                true
            }
            Expr::Literal(EmailLiteral::Bcc(email)) => {
                out.push((AddressKind::Bcc, email));
                true
            }
            Expr::Literal(EmailLiteral::Recipient(email)) => {
                out.push((AddressKind::Recipient, email));
                true
            }
            _ => false,
        }
    }
    let mut out = Vec::new();
    if walk(expr, &mut out) {
        Some(out)
    } else {
        None
    }
}

/// Which roles (sender / TO / CC / BCC) one address predicate was requested
/// in across the OR-tree. Merging roles lets the CTE emit a single recipient
/// branch per address instead of one per role.
#[derive(Default)]
struct AddressKinds {
    sender: bool,
    to: bool,
    cc: bool,
    bcc: bool,
}

impl AddressKinds {
    fn add(&mut self, kind: AddressKind) {
        match kind {
            AddressKind::Sender => self.sender = true,
            AddressKind::Recipient => self.to = true,
            AddressKind::Cc => self.cc = true,
            AddressKind::Bcc => self.bcc = true,
        }
    }

    fn any_recipient(&self) -> bool {
        self.to || self.cc || self.bcc
    }

    /// ` AND mr.recipient_type …` for the requested recipient roles. Empty
    /// when all three are present — TO/CC/BCC is the whole enum, so the
    /// filter would be a no-op. Only meaningful when `any_recipient()`.
    fn recipient_type_sql(&self) -> String {
        let mut types = Vec::new();
        if self.to {
            types.push("'TO'");
        }
        if self.cc {
            types.push("'CC'");
        }
        if self.bcc {
            types.push("'BCC'");
        }
        match types.len() {
            3 => String::new(),
            1 => format!(" AND mr.recipient_type = {}", types[0]),
            _ => format!(" AND mr.recipient_type IN ({})", types.join(", ")),
        }
    }
}

/// Identity of an address predicate for grouping OR'd literals: two literals
/// with equal keys match the same contact rows, so their branches can share
/// contact-resolution work.
#[derive(PartialEq)]
enum AddressGroupKey<'a> {
    /// Complete email resolved to contact ids.
    Contacts(&'a [Uuid]),
    /// Partial text match (source string of the ILIKE pattern).
    Partial(&'a str),
    /// Bare domain, lowercased.
    Domain(String),
}

/// Returns `None` for unresolved Complete emails — they can't match
/// anything, so the literal is dropped rather than emitting a `WHERE FALSE`
/// branch.
fn address_group_key<'a>(
    email: &'a Email,
    resolved: &'a ResolvedFilters,
) -> Option<AddressGroupKey<'a>> {
    match (resolved.contact_ids_for(email), email) {
        (Some(ids), _) => Some(AddressGroupKey::Contacts(ids)),
        (None, Email::Complete(_)) => None,
        (None, Email::Partial(s)) => Some(AddressGroupKey::Partial(s)),
        (None, Email::Domain(s)) => Some(AddressGroupKey::Domain(s.to_ascii_lowercase())),
    }
}

/// Sender branch over resolved contact ids — probes
/// `idx_email_messages_from_contact_id`.
fn contacts_sender_branch(contact_ids: &[Uuid], resolved: &ResolvedFilters) -> SqlFragment {
    let mut f =
        SqlFragment::raw("SELECT m.thread_id FROM email_messages m WHERE m.from_contact_id = ANY(");
    f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
    f.push_raw(") AND ");
    f.extend(build_trash_check(resolved));
    f
}

/// One recipient branch covering every requested recipient role — probes
/// `idx_email_message_recipients_contact_id`.
fn contacts_recipient_branch(
    contact_ids: &[Uuid],
    kinds: &AddressKinds,
    resolved: &ResolvedFilters,
) -> SqlFragment {
    let mut f = SqlFragment::raw(
        "SELECT m.thread_id FROM email_message_recipients mr \
         JOIN email_messages m ON m.id = mr.message_id \
         WHERE mr.contact_id = ANY(",
    );
    f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
    f.push_raw(format!("){}", kinds.recipient_type_sql()));
    f.push_raw(" AND ");
    f.extend(build_trash_check(resolved));
    f
}

/// `AND <alias>.link_id = ANY($links)` when a link scope applies, empty otherwise.
fn link_scope_fragment(alias: &str, link_scope: Option<&[Uuid]>) -> SqlFragment {
    match link_scope {
        Some(links) => {
            let mut f = SqlFragment::raw(format!(" AND {alias}.link_id = ANY("));
            f.extend(SqlFragment::bind_uuid_array(links.to_vec()));
            f.push_raw(")");
            f
        }
        None => SqlFragment::empty(),
    }
}

/// Body of a hoisted `matching_contacts_N` CTE: the contact ids matching one
/// text predicate (ILIKE / domain equality), computed once and shared by the
/// sender/recipient branches that reference it. Materialized so Postgres
/// can't inline it back into each branch as a separate `email_contacts` scan.
///
/// Text matches are not contact-id-scoped like the Complete branches are, so
/// without `link_scope` they match contacts across every mailbox in the
/// table before the candidate stage intersects with the caller's threads.
/// Scoping `c` here (and `m` in the branches) bounds the work to the
/// caller's own mail.
fn matching_contacts_cte_body(
    predicate_prefix: &str,
    bind_value: String,
    link_scope: Option<&[Uuid]>,
) -> SqlFragment {
    let mut f = SqlFragment::raw(format!(
        "SELECT c.id FROM email_contacts c WHERE {predicate_prefix}"
    ));
    f.extend(SqlFragment::bind_string(bind_value));
    f.extend(link_scope_fragment("c", link_scope));
    f
}

/// Sender branch consuming a hoisted `matching_contacts_N` CTE.
fn text_sender_branch(
    cte_name: &str,
    resolved: &ResolvedFilters,
    link_scope: Option<&[Uuid]>,
) -> SqlFragment {
    let mut f = SqlFragment::raw(format!(
        "SELECT m.thread_id FROM {cte_name} c \
         JOIN email_messages m ON m.from_contact_id = c.id \
         WHERE "
    ));
    f.extend(build_trash_check(resolved));
    f.extend(link_scope_fragment("m", link_scope));
    f
}

/// Merged recipient branch consuming a hoisted `matching_contacts_N` CTE.
fn text_recipient_branch(
    cte_name: &str,
    kinds: &AddressKinds,
    resolved: &ResolvedFilters,
    link_scope: Option<&[Uuid]>,
) -> SqlFragment {
    let mut f = SqlFragment::raw(format!(
        "SELECT m.thread_id FROM {cte_name} c \
         JOIN email_message_recipients mr ON mr.contact_id = c.id \
         JOIN email_messages m ON m.id = mr.message_id \
         WHERE "
    ));
    f.extend(build_trash_check(resolved));
    f.push_raw(kinds.recipient_type_sql());
    f.extend(link_scope_fragment("m", link_scope));
    f
}

/// Emits one text-matched group: a hoisted contacts CTE plus the branches
/// that consume it.
fn push_text_group(
    predicate_prefix: &str,
    bind_value: String,
    kinds: &AddressKinds,
    resolved: &ResolvedFilters,
    link_scope: Option<&[Uuid]>,
    contact_ctes: &mut Vec<(String, SqlFragment)>,
    branches: &mut Vec<SqlFragment>,
) {
    let cte_name = format!("matching_contacts_{}", contact_ctes.len());
    contact_ctes.push((
        cte_name.clone(),
        matching_contacts_cte_body(predicate_prefix, bind_value, link_scope),
    ));
    if kinds.sender {
        branches.push(text_sender_branch(&cte_name, resolved, link_scope));
    }
    if kinds.any_recipient() {
        branches.push(text_recipient_branch(
            &cte_name, kinds, resolved, link_scope,
        ));
    }
}

/// The `matching_threads` CTE plus any hoisted contact-lookup CTEs it
/// depends on. `build_query` emits `contact_ctes` (in order) before
/// `matching_threads` in the `WITH` chain.
pub(super) struct MatchingThreadsCtes {
    /// Hoisted `matching_contacts_N` CTEs as `(name, body)` — one per
    /// distinct text-matched (Partial/Domain) address predicate.
    pub(super) contact_ctes: Vec<(String, SqlFragment)>,
    /// Body of the `matching_threads` CTE itself.
    pub(super) body: SqlFragment,
}

/// Builds the `matching_threads` CTE (and any hoisted contact CTEs it
/// needs). Two shapes:
///
/// 1. **UNION-of-branches** (preferred): when the candidate filter is a
///    single conjunct that's a flat OR-tree of positive single-address
///    literals (e.g. `Sender(X) OR Cc(X) OR Bcc(X) OR Recipient(X)`),
///    literals are grouped by address predicate and each group becomes at
///    most two UNION branches: a sender branch and one merged recipient
///    branch covering every requested recipient role (with no
///    `recipient_type` filter at all when all three roles are present).
///    Complete-email branches are index-driven via
///    `idx_email_messages_from_contact_id` /
///    `idx_email_message_recipients_contact_id`; Partial/Domain predicates
///    resolve contacts once in a hoisted `matching_contacts_N` CTE (riding
///    the trigram / domain expression index) that both branches consume,
///    instead of re-scanning `email_contacts` per branch.
/// 2. **Combined predicate**: for everything else (multiple AND conjuncts,
///    NOT inside a conjunct, mixed nested operators) we emit a single
///    `SELECT DISTINCT m.thread_id FROM email_messages m WHERE …` whose
///    WHERE is the AND of all per-conjunct predicates. Single-message
///    semantics is preserved (a thread matches iff ∃ one message satisfying
///    every conjunct).
///
/// Returns `None` when there are no pure-address conjuncts to push down.
///
/// `link_scope` restricts the CTE's contact/message scans to the given
/// links. Only pass it when every candidate thread is known to belong to
/// those links: the caller's own links (owned-only queries) or the team's
/// primary links (team-scoped queries). Shared and project candidate
/// selects include threads from arbitrary links, which a scoped CTE would
/// wrongly filter out.
pub(super) fn build_matching_threads_ctes(
    ast: &Expr<EmailLiteral>,
    resolved: &ResolvedFilters,
    link_scope: Option<&[Uuid]>,
) -> Option<MatchingThreadsCtes> {
    let conjuncts = extract_address_only_conjuncts(ast);
    if conjuncts.is_empty() {
        return None;
    }

    if conjuncts.len() == 1
        && let Some(literals) = flatten_or_tree_of_address_literals(conjuncts[0])
    {
        // Group literals by address predicate so one address requested in
        // several roles (the common "this address anywhere" case) shares
        // branches and contact-resolution work.
        let mut groups: Vec<(AddressGroupKey, AddressKinds)> = Vec::new();
        for (kind, email) in literals {
            let Some(key) = address_group_key(email, resolved) else {
                continue;
            };
            match groups.iter_mut().find(|(k, _)| *k == key) {
                Some((_, kinds)) => kinds.add(kind),
                None => {
                    let mut kinds = AddressKinds::default();
                    kinds.add(kind);
                    groups.push((key, kinds));
                }
            }
        }

        let mut contact_ctes: Vec<(String, SqlFragment)> = Vec::new();
        let mut branches: Vec<SqlFragment> = Vec::new();
        for (key, kinds) in &groups {
            match key {
                AddressGroupKey::Contacts(ids) => {
                    if kinds.sender {
                        branches.push(contacts_sender_branch(ids, resolved));
                    }
                    if kinds.any_recipient() {
                        branches.push(contacts_recipient_branch(ids, kinds, resolved));
                    }
                }
                AddressGroupKey::Partial(s) => {
                    let pattern = format!("%{}%", escape_like_pattern(s));
                    push_text_group(
                        "c.email_address ILIKE ",
                        pattern,
                        kinds,
                        resolved,
                        link_scope,
                        &mut contact_ctes,
                        &mut branches,
                    );
                }
                AddressGroupKey::Domain(domain) => {
                    push_text_group(
                        "LOWER(SPLIT_PART(c.email_address, '@', 2)) = ",
                        domain.clone(),
                        kinds,
                        resolved,
                        link_scope,
                        &mut contact_ctes,
                        &mut branches,
                    );
                }
            }
        }

        if !branches.is_empty() {
            let mut iter = branches.into_iter();
            let mut f = iter.next().expect("non-empty checked above");
            for branch in iter {
                f.push_raw("\n            UNION\n            ");
                f.extend(branch);
            }
            return Some(MatchingThreadsCtes {
                contact_ctes,
                body: f,
            });
        }
        // All literals were unresolved Complete emails — emit a no-rows
        // form so the JOIN against matching_threads is empty.
        return Some(MatchingThreadsCtes {
            contact_ctes: Vec::new(),
            body: SqlFragment::raw("SELECT NULL::uuid AS thread_id WHERE FALSE"),
        });
    }

    // Combined-predicate fallback: AND all conjuncts and emit one subquery.
    let predicate = conjuncts
        .into_iter()
        .map(|c| build_address_message_predicate(c, resolved))
        .reduce(SqlFragment::and)
        .expect("non-empty checked above");

    let mut f = SqlFragment::raw("SELECT DISTINCT m.thread_id FROM email_messages m WHERE ");
    f.extend(build_trash_check(resolved));
    f.push_raw(" AND ");
    f.extend(predicate);
    f.extend(link_scope_fragment("m", link_scope));
    Some(MatchingThreadsCtes {
        contact_ctes: Vec::new(),
        body: f,
    })
}

#[cfg(test)]
impl MatchingThreadsCtes {
    /// Debug SQL over the hoisted CTEs plus the `matching_threads` body, in
    /// emission order. Bind numbering restarts per fragment.
    pub(super) fn to_debug_sql(&self) -> String {
        let mut out = String::new();
        for (name, body) in &self.contact_ctes {
            out.push_str(name);
            out.push_str(" AS MATERIALIZED (");
            out.push_str(&body.to_debug_sql());
            out.push_str(")\n");
        }
        out.push_str(&self.body.to_debug_sql());
        out
    }

    pub(super) fn has_bind_string(&self, expected: &str) -> bool {
        self.contact_ctes
            .iter()
            .any(|(_, b)| b.has_bind_string(expected))
            || self.body.has_bind_string(expected)
    }

    pub(super) fn has_bind_uuid(&self, expected: &Uuid) -> bool {
        self.contact_ctes
            .iter()
            .any(|(_, b)| b.has_bind_uuid(expected))
            || self.body.has_bind_uuid(expected)
    }

    pub(super) fn has_no_raw_containing(&self, needle: &str) -> bool {
        self.contact_ctes
            .iter()
            .all(|(_, b)| b.has_no_raw_containing(needle))
            && self.body.has_no_raw_containing(needle)
    }
}

/// Builds thread-level SQL WHERE conditions. Message-level literals map to TRUE.
pub(super) fn build_thread_email_filter(
    ast: &Expr<EmailLiteral>,
    sort_ts_field: &str,
) -> SqlFragment {
    let fragment = ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => SqlFragment::and(a, b),
        filter_ast::ExprFrame::Or(a, b) => SqlFragment::or(a, b),
        filter_ast::ExprFrame::Not(a) => SqlFragment::not(a),

        filter_ast::ExprFrame::Literal(EmailLiteral::ThreadId(id)) => {
            let mut f = SqlFragment::raw("t.id = ");
            f.extend(SqlFragment::bind_uuid(id));
            f
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::Owner(id)) => {
            let mut f = SqlFragment::raw("t.link_id = ");
            f.extend(SqlFragment::bind_uuid(id));
            f
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::ProjectId(id)) => {
            let mut f = SqlFragment::raw("t.project_id = ");
            f.extend(SqlFragment::bind_string(id));
            f
        }

        // Denormalized flag maintained at attachment ingest — deriving this
        // from email_attachments at query time is prohibitively slow.
        filter_ast::ExprFrame::Literal(EmailLiteral::CalendarOnly(true)) => {
            SqlFragment::raw("t.has_calendar_attachment")
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::CalendarOnly(false)) => {
            SqlFragment::raw("TRUE")
        }

        // Denormalized importance flag maintained by update_thread_metadata
        // (sync_thread_signal_flag) and the email_filters resync fan-out.
        filter_ast::ExprFrame::Literal(EmailLiteral::Importance(true)) => {
            SqlFragment::raw("t.is_signal")
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::Importance(false)) => {
            SqlFragment::raw("(NOT t.is_signal)")
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::CreatedAt(ref lit)) => {
            date_predicate("t.created_at", lit)
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::UpdatedAt(ref lit)) => {
            date_predicate(sort_ts_field, lit)
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::Property(ref lit)) => {
            build_thread_property_predicate(lit)
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::NotificationSeen(true)) => {
            SqlFragment::raw("t.is_read = TRUE")
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::NotificationSeen(false)) => {
            SqlFragment::raw("t.is_read = FALSE")
        }

        filter_ast::ExprFrame::Literal(
            EmailLiteral::Sender(_)
            | EmailLiteral::Cc(_)
            | EmailLiteral::Bcc(_)
            | EmailLiteral::Recipient(_)
            | EmailLiteral::NotificationDone(_)
            | EmailLiteral::Shared(_),
        ) => SqlFragment::raw("TRUE"),
    });

    fragment.with_and_prefix()
}

/// Entity-property predicate for a candidate thread: EXISTS against
/// `entity_properties` keyed on the thread id. A literal typed to a
/// non-thread entity can never match a thread, so it renders FALSE.
fn build_thread_property_predicate(lit: &PropertiesLiteral) -> SqlFragment {
    if lit
        .entity_type
        .is_some_and(|et| et != PropertyEntityType::Thread)
    {
        return SqlFragment::raw("FALSE");
    }
    let mut f = SqlFragment::raw(
        r#"EXISTS (
                SELECT 1 FROM entity_properties ep_prop
                WHERE ep_prop.entity_id = t.id::text
                AND ep_prop.entity_type = 'THREAD'
                AND ep_prop.property_definition_id = "#,
    );
    f.extend(SqlFragment::bind_uuid(lit.property_definition_id));
    match &lit.value {
        PropertyMatchValue::SelectOption(option_id) => {
            f.push_raw(" AND ep_prop.values->'value' ? ");
            f.extend(SqlFragment::bind_string(option_id.to_string()));
        }
        PropertyMatchValue::EntityRef(entity_id) => {
            f.push_raw(" AND ep_prop.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', ");
            f.extend(SqlFragment::bind_string(entity_id.to_string()));
            f.push_raw("::text))");
        }
    }
    f.push_raw(
        r#"
            )"#,
    );
    f
}

/// Escapes special characters in LIKE patterns to prevent SQL injection
pub(super) fn escape_like_pattern(s: &str) -> String {
    s.replace('\\', r"\\")
        .replace('%', r"\%")
        .replace('_', r"\_")
}

/// Builds thread-level WHERE conditions based on the view type
pub(super) fn build_view_thread_filter(view: &PreviewView) -> SqlFragment {
    match view {
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox) => SqlFragment::raw(
            " AND t.inbox_visible = TRUE AND t.latest_inbound_message_ts IS NOT NULL",
        ),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent) => {
            SqlFragment::raw(" AND t.latest_outbound_message_ts IS NOT NULL")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts)
        | PreviewView::StandardLabel(PreviewViewStandardLabel::Starred)
        | PreviewView::StandardLabel(PreviewViewStandardLabel::All)
        | PreviewView::StandardLabel(PreviewViewStandardLabel::Important)
        | PreviewView::UserLabel(_) => SqlFragment::empty(),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Other) => {
            SqlFragment::raw(" AND t.inbox_visible = TRUE")
        }
    }
}

/// Builds message-level WHERE conditions based on the view type
pub(super) fn build_view_message_filter(view: &PreviewView) -> SqlFragment {
    match view {
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox)
        | PreviewView::StandardLabel(PreviewViewStandardLabel::All) => SqlFragment::empty(),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent) => {
            SqlFragment::raw(" AND m.is_sent = TRUE")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts) => {
            SqlFragment::raw(" AND m.is_draft = TRUE")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Starred) => {
            SqlFragment::raw(" AND m.is_starred = TRUE AND m.is_draft = FALSE")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Important) => SqlFragment::raw(
            r#" AND (
                    m.is_draft = TRUE
                    OR EXISTS (
                        SELECT 1 FROM email_message_labels ml
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE ml.message_id = m.id
                        AND l.name = 'IMPORTANT'
                        AND l.link_id = t.link_id
                    )
                )"#,
        ),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Other) => SqlFragment::raw(
            r#" AND NOT EXISTS (
                    SELECT 1 FROM email_message_labels ml
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE ml.message_id = m.id
                    AND l.name IN ('IMPORTANT', 'CATEGORY_PERSONAL')
                    AND l.link_id = t.link_id
                )"#,
        ),
        PreviewView::UserLabel(label_name) => {
            let mut f = SqlFragment::raw(
                r#" AND EXISTS (
                    SELECT 1 FROM email_message_labels ml
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE ml.message_id = m.id
                    AND l.name = "#,
            );
            f.extend(SqlFragment::bind_string(label_name.clone()));
            f.push_raw(
                r#"
                    AND l.link_id = t.link_id
                )"#,
            );
            f
        }
    }
}

/// Returns the appropriate timestamp field to use for sorting based on the view
pub(super) fn get_sort_timestamp_field(view: &PreviewView) -> &'static str {
    match view {
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent) => {
            "t.latest_outbound_message_ts"
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox) => {
            "t.latest_inbound_message_ts"
        }
        _ => "COALESCE(t.latest_non_spam_message_ts, t.updated_at)",
    }
}

/// Builds the LATERAL's TRASH-exclusion fragment using the resolved label id
/// when available. Returns `TRUE` (no exclusion) when the link has no TRASH
/// label — same rationale as `build_trash_check`: a missing TRASH label
/// means no message can be trashed. Anchored on `m.id` inside the LATERAL,
/// so callers shouldn't add their own AND prefix.
pub(super) fn build_lateral_trash_exclusion(resolved: &ResolvedFilters) -> SqlFragment {
    let ids = resolved.trash_label_ids();
    if ids.is_empty() {
        return SqlFragment::raw("TRUE");
    }
    let mut f = SqlFragment::raw(
        r#"NOT EXISTS (
            SELECT 1 FROM email_message_labels ml
            WHERE ml.message_id = m.id AND ml.label_id = ANY("#,
    );
    f.extend(SqlFragment::bind_uuid_array(ids.to_vec()));
    f.push_raw(
        r#")
          )"#,
    );
    f
}
