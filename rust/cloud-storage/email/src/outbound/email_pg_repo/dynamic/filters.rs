use super::SqlFragment;
use super::resolve::ResolvedFilters;
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use filter_ast::Expr;
use item_filters::ast::date::DateLiteral;
use item_filters::ast::email::{Email, EmailLiteral};
use recursion::CollapsibleExt;

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
            | EmailLiteral::ProjectId(_)
            | EmailLiteral::CalendarOnly(_)
            | EmailLiteral::CreatedAt(_)
            | EmailLiteral::UpdatedAt(_),
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
            | EmailLiteral::ProjectId(_)
            | EmailLiteral::Shared(_)
            | EmailLiteral::CalendarOnly(_)
            | EmailLiteral::CreatedAt(_)
            | EmailLiteral::UpdatedAt(_),
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

fn build_sender_importance_override_filter(is_important: bool) -> SqlFragment {
    let importance_literal = if is_important { "TRUE" } else { "FALSE" };
    let opposite_importance_literal = if is_important { "FALSE" } else { "TRUE" };

    SqlFragment::raw(format!(
        r#"(
                    EXISTS (
                        SELECT 1
                        FROM email_contacts sender_c
                        JOIN email_filters ef
                          ON ef.link_id = m.link_id
                         AND ef.email_address IS NOT NULL
                         AND LOWER(ef.email_address) = LOWER(sender_c.email_address)
                        WHERE sender_c.id = m.from_contact_id
                          AND ef.is_important = {importance_literal}
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM email_contacts sender_c
                        JOIN email_filters ef
                          ON ef.link_id = m.link_id
                         AND ef.email_domain IS NOT NULL
                         AND LOWER(ef.email_domain) = LOWER(split_part(sender_c.email_address, '@', 2))
                        WHERE sender_c.id = m.from_contact_id
                          AND ef.is_important = {importance_literal}
                          AND NOT EXISTS (
                              SELECT 1
                              FROM email_filters ef_addr
                              WHERE ef_addr.link_id = m.link_id
                                AND ef_addr.email_address IS NOT NULL
                                AND LOWER(ef_addr.email_address) = LOWER(sender_c.email_address)
                                AND ef_addr.is_important = {opposite_importance_literal}
                          )
                    )
                )"#,
    ))
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
            EmailLiteral::ThreadId(_) | EmailLiteral::ProjectId(_),
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

        filter_ast::ExprFrame::Literal(EmailLiteral::Importance(true)) => {
            let mut f = SqlFragment::raw(
                r#"(
                NOT EXISTS (
                    SELECT 1 FROM email_message_labels ml
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE ml.message_id = m.id
                    AND l.name = 'TRASH'
                )
                AND (
                    "#,
            );
            f.extend(build_sender_importance_override_filter(true));
            f.push_raw(
                r#"
                    OR (
                        NOT "#,
            );
            f.extend(build_sender_importance_override_filter(false));
            f.push_raw(
                r#"
                        AND (
                            m.is_draft = TRUE
                            OR EXISTS (
                                SELECT 1 FROM email_message_labels ml
                                JOIN email_labels l ON ml.label_id = l.id
                                WHERE ml.message_id = m.id
                                AND l.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
                            )
                            OR NOT EXISTS (
                                SELECT 1 FROM email_message_labels ml
                                JOIN email_labels l ON ml.label_id = l.id
                                WHERE ml.message_id = m.id
                                AND l.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
                            )
                        )
                    )
                )
            )"#,
            );
            f
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::Importance(false)) => {
            let mut f = SqlFragment::raw(
                r#"(
                "#,
            );
            f.extend(build_sender_importance_override_filter(false));
            f.push_raw(
                r#"
                OR (
                    NOT "#,
            );
            f.extend(build_sender_importance_override_filter(true));
            f.push_raw(
                r#"
                    AND NOT EXISTS (
                        SELECT 1 FROM email_message_labels ml
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE ml.message_id = m.id
                        AND l.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
                    )
                    AND EXISTS (
                        SELECT 1 FROM email_message_labels ml
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE ml.message_id = m.id
                        AND l.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
                    )
                )
            )"#,
            );
            f
        }
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
/// negatives (e.g., `Sender(X) OR Importance(true)` cannot be reduced to just
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
/// `build_matching_threads_cte_body` and pasted into the top-level `WITH …`
/// chain. Returns empty when there are no pure-address conjuncts to push.
pub(super) fn build_thread_address_filter(ast: &Expr<EmailLiteral>) -> SqlFragment {
    if !wants_address_pushdown(ast) {
        return SqlFragment::empty();
    }
    SqlFragment::raw(" AND t.id IN (SELECT thread_id FROM matching_threads)")
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

/// Builds one `SELECT m.thread_id FROM …` UNION branch for a single
/// positive address literal. Returns `None` for unresolved Complete emails
/// — the branch can't match anything, so we drop it from the UNION rather
/// than emitting a `WHERE FALSE` branch.
fn build_union_branch(
    kind: AddressKind,
    email: &Email,
    resolved: &ResolvedFilters,
) -> Option<SqlFragment> {
    let trash = build_trash_check(resolved);
    match (resolved.contact_ids_for(email), email) {
        (Some(contact_ids), _) => {
            let mut f = match kind {
                AddressKind::Sender => {
                    let mut f = SqlFragment::raw(
                        "SELECT m.thread_id FROM email_messages m WHERE m.from_contact_id = ANY(",
                    );
                    f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
                    f.push_raw(")");
                    f
                }
                _ => {
                    let recipient_type = kind.recipient_type_sql().expect("non-sender kind");
                    let mut f = SqlFragment::raw(
                        "SELECT m.thread_id FROM email_message_recipients mr \
                         JOIN email_messages m ON m.id = mr.message_id \
                         WHERE mr.contact_id = ANY(",
                    );
                    f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
                    f.push_raw(format!(") AND mr.recipient_type = '{recipient_type}'"));
                    f
                }
            };
            f.push_raw(" AND ");
            f.extend(trash);
            Some(f)
        }
        (None, Email::Complete(_)) => None,
        (None, Email::Partial(s)) => {
            let pattern = format!("%{}%", escape_like_pattern(s));
            let mut f = build_union_branch_text_match(kind, "c.email_address ILIKE ", pattern);
            f.push_raw(" AND ");
            f.extend(trash);
            Some(f)
        }
        (None, Email::Domain(s)) => {
            let domain = s.to_ascii_lowercase();
            let mut f = build_union_branch_text_match(
                kind,
                "LOWER(SPLIT_PART(c.email_address, '@', 2)) = ",
                domain,
            );
            f.push_raw(" AND ");
            f.extend(trash);
            Some(f)
        }
    }
}

/// Shared shape for a union-branch SELECT that joins through
/// `email_contacts` with a single bound predicate against `c.*`.
fn build_union_branch_text_match(
    kind: AddressKind,
    predicate_prefix: &str,
    bind_value: String,
) -> SqlFragment {
    match kind {
        AddressKind::Sender => {
            let mut f = SqlFragment::raw(format!(
                "SELECT m.thread_id FROM email_contacts c \
                 JOIN email_messages m ON m.from_contact_id = c.id \
                 WHERE {predicate_prefix}"
            ));
            f.extend(SqlFragment::bind_string(bind_value));
            f
        }
        _ => {
            let recipient_type = kind.recipient_type_sql().expect("non-sender kind");
            let mut f = SqlFragment::raw(format!(
                "SELECT m.thread_id FROM email_contacts c \
                 JOIN email_message_recipients mr ON mr.contact_id = c.id \
                 JOIN email_messages m ON m.id = mr.message_id \
                 WHERE {predicate_prefix}"
            ));
            f.extend(SqlFragment::bind_string(bind_value));
            f.push_raw(format!(" AND mr.recipient_type = '{recipient_type}'"));
            f
        }
    }
}

/// Builds the body of the `matching_threads` CTE — i.e., everything
/// between `MATERIALIZED (` and `)`. Two shapes:
///
/// 1. **UNION-of-branches** (preferred): when the candidate filter is a
///    single conjunct that's a flat OR-tree of positive single-address
///    literals (e.g. `Sender(X) OR Cc(X) OR Bcc(X) OR Recipient(X)`), each
///    literal becomes its own UNION branch. Each branch is index-driven
///    via `idx_email_messages_from_contact_id` /
///    `idx_email_message_recipients_contact_id`, so total work is
///    proportional to the contact's actual mention count rather than
///    mailbox size.
/// 2. **Combined predicate**: for everything else (multiple AND conjuncts,
///    NOT inside a conjunct, mixed nested operators) we emit a single
///    `SELECT DISTINCT m.thread_id FROM email_messages m WHERE …` whose
///    WHERE is the AND of all per-conjunct predicates. Single-message
///    semantics is preserved (a thread matches iff ∃ one message satisfying
///    every conjunct).
///
/// Returns `None` when there are no pure-address conjuncts to push down.
pub(super) fn build_matching_threads_cte_body(
    ast: &Expr<EmailLiteral>,
    resolved: &ResolvedFilters,
) -> Option<SqlFragment> {
    let conjuncts = extract_address_only_conjuncts(ast);
    if conjuncts.is_empty() {
        return None;
    }

    if conjuncts.len() == 1
        && let Some(literals) = flatten_or_tree_of_address_literals(conjuncts[0])
    {
        let branches: Vec<SqlFragment> = literals
            .into_iter()
            .filter_map(|(k, e)| build_union_branch(k, e, resolved))
            .collect();
        if !branches.is_empty() {
            let mut iter = branches.into_iter();
            let mut f = iter.next().expect("non-empty checked above");
            for branch in iter {
                f.push_raw("\n            UNION\n            ");
                f.extend(branch);
            }
            return Some(f);
        }
        // All branches were unresolved Complete emails — emit a no-rows
        // form so the JOIN against matching_threads is empty.
        return Some(SqlFragment::raw(
            "SELECT NULL::uuid AS thread_id WHERE FALSE",
        ));
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
    Some(f)
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

        filter_ast::ExprFrame::Literal(EmailLiteral::ProjectId(id)) => {
            let mut f = SqlFragment::raw("t.project_id = ");
            f.extend(SqlFragment::bind_string(id));
            f
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::CalendarOnly(true)) => SqlFragment::raw(
            r#"EXISTS (
                    SELECT 1
                    FROM email_messages m_cal
                    JOIN email_attachments a_cal ON a_cal.message_id = m_cal.id
                    WHERE m_cal.thread_id = t.id
                      AND (
                        a_cal.filename ILIKE '%.ics'
                        OR a_cal.mime_type = 'text/calendar'
                        OR a_cal.mime_type = 'application/ics'
                      )
                )"#,
        ),

        filter_ast::ExprFrame::Literal(EmailLiteral::CalendarOnly(false)) => {
            SqlFragment::raw("TRUE")
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::CreatedAt(ref lit)) => {
            date_predicate("t.created_at", lit)
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::UpdatedAt(ref lit)) => {
            date_predicate(sort_ts_field, lit)
        }

        filter_ast::ExprFrame::Literal(
            EmailLiteral::Sender(_)
            | EmailLiteral::Cc(_)
            | EmailLiteral::Bcc(_)
            | EmailLiteral::Recipient(_)
            | EmailLiteral::Importance(_)
            | EmailLiteral::NotificationDone(_)
            | EmailLiteral::NotificationSeen(_)
            | EmailLiteral::Shared(_),
        ) => SqlFragment::raw("TRUE"),
    });

    fragment.with_and_prefix()
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
