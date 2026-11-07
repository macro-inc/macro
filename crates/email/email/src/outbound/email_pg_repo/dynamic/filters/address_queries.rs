use super::*;

#[cfg(test)]
mod test;

/// The mailbox check each `matching_threads` branch applies to its messages.
#[derive(Clone, Copy)]
pub(in super::super) enum BranchFacts<'a> {
    /// Present, and outside trash unless the view is Trash.
    Checked(&'a ResolvedFilters),
    /// None: the branches list a superset of the candidate threads, which
    /// the caller matches thread by thread with the full message check and
    /// its inboxes.
    Skipped { probe_limit: Option<i64> },
}

impl BranchFacts<'_> {
    fn check(self) -> SqlFragment {
        match self {
            Self::Checked(resolved) => build_trash_check(resolved),
            Self::Skipped { .. } => SqlFragment::raw("TRUE"),
        }
    }

    /// The inboxes a text branch keeps its messages to. A superset leaves
    /// that to its caller: its contacts are already the inboxes' own, and
    /// the planner would AND each contact's messages with a bitmap of the
    /// whole inbox.
    fn message_scope(self, link_scope: Option<&[Uuid]>) -> Option<&[Uuid]> {
        match self {
            Self::Checked(_) => link_scope,
            Self::Skipped { .. } => None,
        }
    }
}

/// Sender branch over resolved contact ids — probes
/// `idx_email_messages_from_contact_id`.
pub(super) fn contacts_sender_branch(contact_ids: &[Uuid], facts: BranchFacts) -> SqlFragment {
    let mut f =
        SqlFragment::raw("SELECT m.thread_id FROM email_messages m WHERE m.from_contact_id = ANY(");
    f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
    f.push_raw(") AND ");
    f.extend(facts.check());
    f
}

/// One recipient branch covering every requested recipient role — probes
/// `idx_email_message_recipients_contact_id`.
pub(super) fn contacts_recipient_branch(
    contact_ids: &[Uuid],
    kinds: &AddressKinds,
    facts: BranchFacts,
) -> SqlFragment {
    // Drive capped probes and sparse pages from the group's deduplicated
    // contact IDs. Fence both lookups: generic joins can otherwise scan
    // either whole table. A rare role on a dense contact needs the original
    // role-first or parallel plan, as do dense and checked reads.
    if let BranchFacts::Skipped {
        probe_limit: Some(_),
    } = facts
        && kinds.to
        && kinds.cc
        && kinds.bcc
    {
        let mut f = SqlFragment::raw("SELECT m.thread_id FROM unnest(");
        f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
        f.push_raw(
            "::uuid[]) c(id) CROSS JOIN LATERAL (\
                 SELECT mr.message_id FROM email_message_recipients mr \
                 WHERE mr.contact_id = c.id OFFSET 0\
             ) mr CROSS JOIN LATERAL (\
                 SELECT thread_id FROM email_messages \
                 WHERE id = mr.message_id OFFSET 0\
             ) m WHERE TRUE",
        );
        return f;
    }
    let mut f = SqlFragment::raw(
        "SELECT m.thread_id FROM email_message_recipients mr \
         JOIN email_messages m ON m.id = mr.message_id \
         WHERE mr.contact_id = ANY(",
    );
    f.extend(SqlFragment::bind_uuid_array(contact_ids.to_vec()));
    f.push_raw(format!("){}", kinds.recipient_type_sql()));
    f.push_raw(" AND ");
    f.extend(facts.check());
    f
}

/// `AND <alias>.link_id = ANY($links)` when a link scope applies, empty otherwise.
pub(super) fn link_scope_fragment(alias: &str, link_scope: Option<&[Uuid]>) -> SqlFragment {
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
pub(super) fn matching_contacts_cte_body(
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
    facts: BranchFacts,
    link_scope: Option<&[Uuid]>,
) -> SqlFragment {
    let mut f = SqlFragment::raw(format!("SELECT m.thread_id FROM {cte_name} c "));
    // The fence prevents a whole-message scan. The limit also lets generic
    // plans stop on a dense sender's index instead of building its full bitmap.
    // One contact reaching this limit already exceeds the global probe cap;
    // a page proven sparse by that probe never reaches it.
    match facts {
        BranchFacts::Skipped {
            probe_limit: Some(limit),
        } => {
            f.push_raw(
                "CROSS JOIN LATERAL ( \
                     SELECT id, thread_id, link_id FROM email_messages \
                     WHERE from_contact_id = c.id LIMIT ",
            );
            f.extend(SqlFragment::bind_i64(limit));
            f.push_raw(" OFFSET 0 ) m WHERE ");
        }
        BranchFacts::Checked(_) | BranchFacts::Skipped { .. } => {
            f.push_raw("JOIN email_messages m ON m.from_contact_id = c.id WHERE ");
        }
    }
    f.extend(facts.check());
    f.extend(link_scope_fragment("m", link_scope));
    f
}

/// Merged recipient branch consuming a hoisted `matching_contacts_N` CTE.
fn text_recipient_branch(
    cte_name: &str,
    kinds: &AddressKinds,
    facts: BranchFacts,
    link_scope: Option<&[Uuid]>,
) -> SqlFragment {
    // Fence all-role branches of the capped probe and sparse page: overestimated
    // contact matches otherwise scan either whole table. Keep joined SQL for
    // dense, checked, and role-restricted branches; a rare role can still read
    // every recipient of a dense domain before the cap finds a matching row.
    let joins = match facts {
        BranchFacts::Skipped {
            probe_limit: Some(_),
        } if kinds.to && kinds.cc && kinds.bcc => {
            "CROSS JOIN LATERAL ( \
                 SELECT message_id, recipient_type FROM email_message_recipients \
                 WHERE contact_id = c.id OFFSET 0 \
             ) mr \
             CROSS JOIN LATERAL ( \
                 SELECT id, thread_id, link_id FROM email_messages \
                 WHERE id = mr.message_id OFFSET 0 \
             ) m "
        }
        BranchFacts::Checked(_) | BranchFacts::Skipped { .. } => {
            "JOIN email_message_recipients mr ON mr.contact_id = c.id \
             JOIN email_messages m ON m.id = mr.message_id "
        }
    };
    let mut f = SqlFragment::raw(format!(
        "SELECT m.thread_id FROM {cte_name} c {joins}WHERE "
    ));
    f.extend(facts.check());
    f.push_raw(kinds.recipient_type_sql());
    f.extend(link_scope_fragment("m", link_scope));
    f
}

/// Emits one text-matched group: a hoisted contacts CTE plus the branches
/// that consume it.
pub(super) fn push_contact_group(
    contact_query: SqlFragment,
    kinds: &AddressKinds,
    facts: BranchFacts,
    link_scope: Option<&[Uuid]>,
    contact_ctes: &mut Vec<(String, SqlFragment)>,
    branches: &mut Vec<SqlFragment>,
) {
    let cte_name = format!("matching_contacts_{}", contact_ctes.len());
    contact_ctes.push((cte_name.clone(), contact_query));
    let message_scope = facts.message_scope(link_scope);
    if kinds.sender {
        branches.push(text_sender_branch(&cte_name, facts, message_scope));
    }
    if kinds.any_recipient() {
        branches.push(text_recipient_branch(
            &cte_name,
            kinds,
            facts,
            message_scope,
        ));
    }
}

/// The `matching_threads` CTE plus any hoisted contact-lookup CTEs it
/// depends on. `build_query` emits `contact_ctes` (in order) before
/// `matching_threads` in the `WITH` chain.
pub(in super::super) struct MatchingThreadsCtes {
    /// Hoisted `matching_contacts_N` CTEs as `(name, body)` — one per
    /// distinct text-matched (Partial/Domain) address predicate.
    pub(in super::super) contact_ctes: Vec<(String, SqlFragment)>,
    /// Body of the `matching_threads` CTE itself.
    pub(in super::super) body: SqlFragment,
}

/// Builds the `matching_threads` CTE (and any hoisted contact CTEs it
/// needs). Two shapes:
///
/// 1. **UNION-of-branches** (preferred): when the candidate filter is a
///    single conjunct that's a flat OR-tree of positive single-address
///    literals (e.g. `Sender(X) OR Cc(X) OR Bcc(X) OR Recipient(X)`),
///    predicates first collect their requested roles. Complete addresses and
///    domains with identical role sets then share membership branches, keeping
///    query size bounded for large CRMs. Complete-email branches use the
///    contact-id indexes; domains resolve contacts once per role set in a
///    hoisted `matching_contacts_N` CTE. Partial matches remain independent.
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
pub(in super::super) fn build_matching_threads_ctes(
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
        let (contact_ctes, branches) = address_groups::build(
            literals,
            resolved,
            BranchFacts::Checked(resolved),
            link_scope,
        );

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

/// The threads that may match a positive OR-tree of addresses: `SELECT
/// m.thread_id` branches over the address indexes, without the mailbox facts
/// probe, plus the hoisted contact CTEs they read. The team-scoped CRM query
/// and the owned address read (`dynamic/query/owned_scope.rs`) count and sort
/// these threads, then give each thread they read the full message match
/// (`build_thread_message_exists_filter`, the preview pick), which implies the
/// branch condition: a thread's messages and contacts share its link. The
/// owned read also checks that ([`ContactScope`]).
#[derive(Clone)]
pub(in super::super) struct AddressSuperset {
    pub(in super::super) contact_ctes: Vec<(String, SqlFragment)>,
    pub(in super::super) branches: Vec<SqlFragment>,
    /// Sender and recipient probes for the initial capped count and a sparse page.
    pub(in super::super) indexed_branches: Vec<SqlFragment>,
}

/// [`AddressSuperset`] for a tree whose only pure-address top-level conjunct
/// is a flat OR-tree of positive address literals (a CRM record's addresses
/// and domains), scoped to `links`, and `None` for any other tree. A complete
/// address keeps only the contacts of `links`' inboxes, so a record whose
/// addresses have no contact there gets no branches: nothing can match.
/// Indexed sender branches stop one past `superset_limit`: that proves the
/// superset is too large, and cannot truncate a page the probe proved fits.
pub(in super::super) fn build_address_superset(
    ast: &Expr<EmailLiteral>,
    resolved: &ResolvedFilters,
    links: &[Uuid],
    superset_limit: i64,
) -> Option<AddressSuperset> {
    let conjuncts = extract_address_only_conjuncts(ast);
    let [conjunct] = conjuncts.as_slice() else {
        return None;
    };
    let literals = flatten_or_tree_of_address_literals(conjunct)?;
    let resolved = resolved.within_links(links);
    let (contact_ctes, branches) = address_groups::build(
        literals.clone(),
        &resolved,
        BranchFacts::Skipped { probe_limit: None },
        Some(links),
    );
    let (_, indexed_branches) = address_groups::build(
        literals,
        &resolved,
        BranchFacts::Skipped {
            probe_limit: Some(superset_limit.saturating_add(1).max(0)),
        },
        Some(links),
    );
    Some(AddressSuperset {
        contact_ctes,
        branches,
        indexed_branches,
    })
}

/// How the owned address read keeps a thread's match to the queried inboxes'
/// contacts, as the general builder's `matching_threads` does. The preview
/// pick matches a domain or partial address on any inbox's contact, as in the
/// general builder; a message lists only its own inbox's contacts
/// (`parse_and_upsert_message_contacts`), but no constraint keeps it so.
#[derive(Clone)]
pub(in super::super) struct ContactScope {
    /// True when every contact on `m` is one of the inboxes', so a match on
    /// `m` is a match through their contacts.
    pub(in super::super) own_contacts: SqlFragment,
    /// The thread `t` has a present message outside trash that matches the
    /// tree through the inboxes' contacts: `matching_threads`' condition.
    pub(in super::super) member: SqlFragment,
}

/// [`ContactScope`] on the contacts of `links` for the tree
/// [`build_address_superset`] reads, when it has a domain or partial address,
/// and `None` otherwise: complete addresses resolved to the inboxes' contacts,
/// so only text matches can reach another inbox's.
pub(in super::super) fn build_contact_scope(
    ast: &Expr<EmailLiteral>,
    resolved: &ResolvedFilters,
    links: &[Uuid],
) -> Option<ContactScope> {
    let conjuncts = extract_address_only_conjuncts(ast);
    let [conjunct] = conjuncts.as_slice() else {
        return None;
    };
    let literals = flatten_or_tree_of_address_literals(conjunct)?;
    if literals
        .iter()
        .all(|(_, email)| matches!(email, Email::Complete(_)))
    {
        return None;
    }
    let scoped = resolved.text_matches_within(links);
    let mut member =
        SqlFragment::raw("EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = t.id AND ");
    member.extend(build_trash_check(&scoped));
    member.push_raw(" AND ");
    member.extend(address_groups::message_predicate(literals, &scoped));
    member.push_raw(")");
    Some(ContactScope {
        own_contacts: own_contacts(links),
        member,
    })
}

/// True when no contact on `m`, sender or recipient, is outside `links`.
fn own_contacts(links: &[Uuid]) -> SqlFragment {
    let mut f = SqlFragment::raw(
        "NOT EXISTS (SELECT 1 FROM email_contacts c \
         WHERE c.id = m.from_contact_id AND NOT (c.link_id = ANY(",
    );
    f.extend(SqlFragment::bind_uuid_array(links.to_vec()));
    f.push_raw(
        "))) AND NOT EXISTS (SELECT 1 FROM email_message_recipients mr \
         JOIN email_contacts c ON c.id = mr.contact_id \
         WHERE mr.message_id = m.id AND NOT (c.link_id = ANY(",
    );
    f.extend(SqlFragment::bind_uuid_array(links.to_vec()));
    f.push_raw(")))");
    f
}
