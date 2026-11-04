//! A disposable predicate-index profile, not another contact dataset. Only
//! viewer-scoped `GraphqlContact` records can supply membership and private names.

use crate::{
    people::contact_key,
    predicate::ProjectionState,
    value::{CacheValue, EntityKey, Record},
};
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use predicate_index::{
    ExactFact, ExactValue, IndexDocument, Profile, ProjectionIncompleteKind, RecordKey, Token,
    ValidationError,
};
use uuid::Uuid;

/// Predicate profile owned by local people SQL.
pub const PROFILE: &str = "people-sql-v1";
/// Fields required from a normalized contact; local ranking facts are unrelated.
pub const FIELDS: &[&str] = &["userId", "email", "name"];

/// Opaque account partition, bound by the engine rather than supplied in SQL.
pub fn partition(viewer: &str) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_OID, viewer.as_bytes()).to_string()
}

/// Project one server-owned membership record. A context stub or a record keyed
/// for another viewer does not become personal membership. Partial/malformed
/// membership remains incomplete instead of silently disappearing from counts.
pub fn project(
    viewer: &str,
    key: &EntityKey<'_>,
    record: &Record,
) -> Result<Option<ProjectionState>, ValidationError> {
    if !key.as_ref().starts_with("GraphqlContact:")
        || !FIELDS
            .iter()
            .any(|field| record.fields.contains_key(*field))
    {
        return Ok(None);
    }
    let record_key = RecordKey::new(key.as_ref())?;
    let profile = Profile::new(Token::new(PROFILE)?);
    let partition = Token::new(partition(viewer))?;
    let incomplete = || {
        Some(ProjectionState::Incomplete {
            record_key: record_key.clone(),
            profile: profile.clone(),
            partition: partition.clone(),
            kind: ProjectionIncompleteKind::Missing,
        })
    };
    let Some(CacheValue::String(user)) = record.fields.get("userId") else {
        return Ok(incomplete());
    };
    if user.len() > 1024 {
        return Ok(incomplete());
    }
    let Ok(user) = MacroUserIdStr::parse_from_str(user) else {
        return Ok(incomplete());
    };
    if contact_key(viewer, user.as_ref()).as_ref() != key.as_ref() {
        return Ok(None);
    }
    let Some(CacheValue::String(email)) = record.fields.get("email") else {
        return Ok(incomplete());
    };
    if !email.eq_ignore_ascii_case(user.email_str()) {
        return Ok(incomplete());
    }
    let address = user.email_part();
    let name = match record.fields.get("name") {
        Some(CacheValue::String(name)) => name.as_str(),
        Some(CacheValue::Null) => address.local_part(),
        _ => return Ok(incomplete()),
    };
    let values = [
        ("id", user.as_ref().to_owned()),
        ("name", name.to_owned()),
        ("email", user.email_str().to_owned()),
        (
            "row_id",
            Uuid::new_v5(&Uuid::NAMESPACE_OID, user.as_ref().as_bytes()).to_string(),
        ),
        ("name_lower", name.to_lowercase()),
        ("email_lower", user.email_str().to_lowercase()),
    ];
    let mut exact_facts = Vec::with_capacity(values.len());
    for (attribute, value) in values {
        // SQLite LIKE stops at NUL. Never let that silently change SQL semantics.
        if value.contains('\0') {
            return Ok(incomplete());
        }
        let Ok(value) = ExactValue::new(value.into_bytes()) else {
            return Ok(incomplete());
        };
        exact_facts.push(ExactFact {
            attribute: Token::new(attribute)?,
            value,
        });
    }
    let mut document = IndexDocument {
        record_key,
        profile,
        partition,
        exact_facts,
        integer_facts: vec![],
        sort_facts: vec![],
    };
    document.canonicalize();
    Ok(Some(ProjectionState::Complete(document)))
}
