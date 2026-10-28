//! Compact membership branches for positive OR-only address filters.

use std::collections::BTreeMap;

use item_filters::ast::email::Email;
use uuid::Uuid;

use super::{
    AddressKind, AddressKinds, ResolvedFilters, SqlFragment, build_address_predicate_on_m,
    contacts_recipient_branch, contacts_sender_branch, escape_like_pattern, link_scope_fragment,
    matching_contacts_cte_body, push_contact_group,
};

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum AddressKey<'a> {
    Contacts(&'a [Uuid]),
    Partial(&'a str),
    Domain(String),
}

fn address_key<'a>(email: &'a Email, resolved: &'a ResolvedFilters) -> Option<AddressKey<'a>> {
    match (resolved.contact_ids_for(email), email) {
        (Some(ids), _) => Some(AddressKey::Contacts(ids)),
        (None, Email::Complete(_)) => None,
        (None, Email::Partial(value)) => Some(AddressKey::Partial(value)),
        (None, Email::Domain(value)) => Some(AddressKey::Domain(value.to_ascii_lowercase())),
    }
}

#[derive(Default)]
struct Members {
    contact_ids: Vec<Uuid>,
    domains: Vec<String>,
}

#[derive(Default)]
struct Groups<'a> {
    memberships: BTreeMap<AddressKinds, Members>,
    partials: Vec<(&'a str, AddressKinds)>,
}

fn group<'a>(literals: Vec<(AddressKind, &'a Email)>, resolved: &'a ResolvedFilters) -> Groups<'a> {
    // First merge roles for the same predicate. A tree with thousands of
    // addresses must not perform a linear scan of earlier addresses per leaf.
    let mut groups = BTreeMap::<AddressKey, AddressKinds>::new();
    for (kind, email) in literals {
        if let Some(key) = address_key(email, resolved) {
            groups.entry(key).or_default().add(kind);
        }
    }

    let mut result = Groups::default();
    for (key, kinds) in groups {
        match key {
            AddressKey::Contacts(ids) => result
                .memberships
                .entry(kinds)
                .or_default()
                .contact_ids
                .extend_from_slice(ids),
            AddressKey::Domain(domain) => {
                result
                    .memberships
                    .entry(kinds)
                    .or_default()
                    .domains
                    .push(domain);
            }
            AddressKey::Partial(value) => result.partials.push((value, kinds)),
        }
    }
    for members in result.memberships.values_mut() {
        members.contact_ids.sort_unstable();
        members.contact_ids.dedup();
    }
    result
}

pub(super) fn build(
    literals: Vec<(AddressKind, &Email)>,
    resolved: &ResolvedFilters,
    link_scope: Option<&[Uuid]>,
) -> (Vec<(String, SqlFragment)>, Vec<SqlFragment>) {
    let Groups {
        memberships,
        partials,
    } = group(literals, resolved);
    let mut contact_ctes = Vec::new();
    let mut branches = Vec::new();
    for (value, kinds) in partials {
        push_contact_group(
            matching_contacts_cte_body(
                "c.email_address ILIKE ",
                format!("%{}%", escape_like_pattern(value)),
                link_scope,
            ),
            &kinds,
            resolved,
            link_scope,
            &mut contact_ctes,
            &mut branches,
        );
    }

    // Only identical role sets share a membership list: combining Sender(A)
    // with Cc(B) must not admit Sender(B) or Cc(A).
    for (kinds, members) in memberships {
        if !members.contact_ids.is_empty() {
            if kinds.sender {
                branches.push(contacts_sender_branch(&members.contact_ids, resolved));
            }
            if kinds.any_recipient() {
                branches.push(contacts_recipient_branch(
                    &members.contact_ids,
                    &kinds,
                    resolved,
                ));
            }
        }
        if !members.domains.is_empty() {
            let contact_query = domain_contacts(members.domains, link_scope);
            push_contact_group(
                contact_query,
                &kinds,
                resolved,
                link_scope,
                &mut contact_ctes,
                &mut branches,
            );
        }
    }
    (contact_ctes, branches)
}

fn domain_contacts(domains: Vec<String>, link_scope: Option<&[Uuid]>) -> SqlFragment {
    if let [domain] = domains.as_slice() {
        return matching_contacts_cte_body(
            "LOWER(SPLIT_PART(c.email_address, '@', 2)) = ",
            domain.clone(),
            link_scope,
        );
    }
    let mut query = SqlFragment::raw(
        "SELECT c.id FROM email_contacts c \
         WHERE LOWER(SPLIT_PART(c.email_address, '@', 2)) = ANY(",
    );
    query.extend(SqlFragment::bind_string_array(domains));
    query.push_raw(")");
    query.extend(link_scope_fragment("c", link_scope));
    query
}

/// Match the particular message selected by the LATERAL, not just its thread.
/// Reusing only the matching_threads CTE here would admit unrelated messages.
pub(super) fn message_predicate(
    literals: Vec<(AddressKind, &Email)>,
    resolved: &ResolvedFilters,
) -> SqlFragment {
    let Groups {
        memberships,
        partials,
    } = group(literals, resolved);
    let mut predicates = Vec::new();
    for (value, kinds) in partials {
        let email = Email::Partial(value.to_owned());
        for (enabled, kind) in [
            (kinds.sender, AddressKind::Sender),
            (kinds.to, AddressKind::Recipient),
            (kinds.cc, AddressKind::Cc),
            (kinds.bcc, AddressKind::Bcc),
        ] {
            if enabled {
                predicates.push(build_address_predicate_on_m(kind, &email, resolved));
            }
        }
    }
    for (kinds, members) in memberships {
        if !members.contact_ids.is_empty() {
            if kinds.sender {
                let mut predicate = SqlFragment::raw("m.from_contact_id = ANY(");
                predicate.extend(SqlFragment::bind_uuid_array(members.contact_ids.clone()));
                predicate.push_raw(")");
                predicates.push(predicate);
            }
            if kinds.any_recipient() {
                let mut predicate = SqlFragment::raw(format!(
                    "EXISTS (SELECT 1 FROM email_message_recipients mr WHERE mr.message_id = m.id{} AND mr.contact_id = ANY(",
                    kinds.recipient_type_sql()
                ));
                predicate.extend(SqlFragment::bind_uuid_array(members.contact_ids));
                predicate.push_raw("))");
                predicates.push(predicate);
            }
        }
        if !members.domains.is_empty() {
            if kinds.sender {
                predicates.push(message_domains(&members.domains, None));
            }
            if kinds.any_recipient() {
                predicates.push(message_domains(&members.domains, Some(kinds)));
            }
        }
    }
    predicates
        .into_iter()
        .reduce(SqlFragment::or)
        .unwrap_or_else(|| SqlFragment::raw("FALSE"))
}

fn message_domains(domains: &[String], recipients: Option<AddressKinds>) -> SqlFragment {
    let mut predicate = match recipients {
        None => SqlFragment::raw(
            "EXISTS (SELECT 1 FROM email_contacts c WHERE c.id = m.from_contact_id AND ",
        ),
        Some(kinds) => SqlFragment::raw(format!(
            "EXISTS (SELECT 1 FROM email_message_recipients mr JOIN email_contacts c ON c.id = mr.contact_id WHERE mr.message_id = m.id{} AND ",
            kinds.recipient_type_sql()
        )),
    };
    predicate.push_raw("LOWER(SPLIT_PART(c.email_address, '@', 2)) = ANY(");
    predicate.extend(SqlFragment::bind_string_array(domains.to_vec()));
    predicate.push_raw("))");
    predicate
}
