//! Sort facts derived from a document's other facts (`SortFactDerivation`).
//! A projection writes them as it projects; a cache written before a rule
//! existed gets them here, in place, from the facts it already holds, so its
//! records and queued mutations stay.

use super::*;
use item_filter_index::SORT_FACT_DERIVATIONS;
use predicate_index::SortFactDerivation;

const VERSION_KEY: &str = "sort_fact_derivations";
const META_SELECT: &str = "SELECT value FROM meta WHERE key = ?1";
const META_UPSERT: &str = "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";

struct Tables {
    documents: &'static str,
    exact: &'static str,
    integers: &'static str,
    sorts: &'static str,
    optimistic: bool,
}

const AUTHORITATIVE: Tables = Tables {
    documents: "index_documents",
    exact: "exact_facts",
    integers: "integer_facts",
    sorts: "sort_facts",
    optimistic: false,
};

const OPTIMISTIC: Tables = Tables {
    documents: "optimistic_index_documents",
    exact: "optimistic_exact_facts",
    integers: "optimistic_integer_facts",
    sorts: "optimistic_sort_facts",
    optimistic: true,
};

fn fingerprint(derivations: &[SortFactDerivation]) -> String {
    derivations
        .iter()
        .map(SortFactDerivation::fingerprint)
        .collect::<Vec<_>>()
        .join(";")
}

pub(super) fn save_version(connection: &Db) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        META_UPSERT,
        vec![text(VERSION_KEY), text(&fingerprint(SORT_FACT_DERIVATIONS))],
    )?;
    Ok(())
}

/// Applies the current rules to every stored document once, when they differ
/// from the rules the cache was last written with.
pub(super) fn ensure_version(connection: &Db) -> Result<(), TursoStorageError> {
    let versions = driver::query(connection, META_SELECT, vec![text(VERSION_KEY)])?;
    if let [row] = versions.as_slice()
        && required_text(row, 0)? == fingerprint(SORT_FACT_DERIVATIONS)
    {
        return Ok(());
    }
    driver::write_transaction(connection, || {
        for derivation in SORT_FACT_DERIVATIONS {
            derive(connection, derivation)?;
        }
        save_version(connection)
    })
}

/// `?start, ?start+1, ...` for `count` parameters.
fn placeholders(start: usize, count: usize) -> String {
    (start..start + count)
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `first` followed by every profile the derivation applies to.
fn with_profiles(first: Vec<Value>, derivation: &SortFactDerivation) -> Vec<Value> {
    first
        .into_iter()
        .chain(derivation.profiles.iter().map(|profile| text(profile)))
        .collect()
}

fn derive(connection: &Db, derivation: &SortFactDerivation) -> Result<(), TursoStorageError> {
    let profiles = derivation.profiles.len();
    // Statements that bind the target alone take the profiles from ?2, those
    // that bind the target and the source from ?3.
    let after_target = placeholders(2, profiles);
    let after_source = placeholders(3, profiles);
    for tables in [AUTHORITATIVE, OPTIMISTIC] {
        let Tables {
            documents,
            exact,
            sorts,
            ..
        } = tables;
        driver::execute(
            connection,
            &format!(
                "DELETE FROM {sorts} WHERE attribute = ?1 AND document_id IN (SELECT id FROM {documents} WHERE profile IN ({after_target}))"
            ),
            with_profiles(vec![text(derivation.target)], derivation),
        )?;
        let mut parameters = with_profiles(
            vec![text(derivation.target), text(derivation.source)],
            derivation,
        );
        let mut required = String::new();
        for (attribute, value) in derivation.required {
            let attribute_parameter = parameters.len() + 1;
            parameters.push(text(attribute));
            parameters.push(Value::from_blob(value.to_vec()));
            let value_parameter = attribute_parameter + 1;
            required.push_str(&format!(
                " AND EXISTS (SELECT 1 FROM {exact} AS e WHERE e.document_id = s.document_id AND e.attribute = ?{attribute_parameter} AND e.value = ?{value_parameter})"
            ));
        }
        let eligible = format!(
            "FROM {sorts} AS s JOIN {documents} AS d ON d.id = s.document_id WHERE s.attribute = ?2 AND d.profile IN ({after_source}){required}"
        );
        driver::execute(
            connection,
            &format!(
                "INSERT INTO {sorts} (document_id, attribute, value) SELECT s.document_id, ?1, s.value {eligible}"
            ),
            parameters,
        )?;
        mark_over_limit_incomplete(connection, &tables, derivation)?;
    }
    derive_uncertainty(connection, derivation)
}

/// Gives each uncertain optimistic row the uncertainty composition gives a
/// derived fact: as uncertain as its source and required facts. Rows store
/// either a list of uncertain attributes or "all except" a certain list, so
/// each is decoded and rewritten with the shared rule rather than in SQL.
fn derive_uncertainty(
    connection: &Db,
    derivation: &SortFactDerivation,
) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        &format!(
            "SELECT u.document_id, d.profile, u.attribute FROM optimistic_uncertain_attributes AS u JOIN optimistic_index_documents AS d ON d.id = u.document_id WHERE d.profile IN ({}) ORDER BY u.document_id",
            placeholders(1, derivation.profiles.len())
        ),
        with_profiles(Vec::new(), derivation),
    )?;
    let mut documents: Vec<(i64, String, Vec<String>)> = Vec::new();
    for row in &rows {
        let document_id = required_i64(row, 0)?;
        let attribute = required_text(row, 2)?;
        match documents.last_mut() {
            Some((last, _, attributes)) if *last == document_id => attributes.push(attribute),
            _ => documents.push((document_id, required_text(row, 1)?, vec![attribute])),
        }
    }
    for (document_id, profile, attributes) in documents {
        let stored = parse_optimistic_uncertainty(attributes)?;
        let profile = Profile::new(Token::new(&profile).map_err(|_| invariant())?);
        let mut derived = stored.clone();
        derivation.apply_uncertainty(&profile, &mut derived);
        if derived == stored {
            continue;
        }
        driver::execute(
            connection,
            "DELETE FROM optimistic_uncertain_attributes WHERE document_id = ?1",
            vec![Value::from_i64(document_id)],
        )?;
        write_optimistic_uncertainty(connection, document_id, derived)?;
    }
    Ok(())
}

/// A document the derived fact took past `MAX_ATTRIBUTES_PER_DOCUMENT`
/// distinct attributes becomes incomplete, as composition makes it, so its
/// queries fall back and loads do not refuse it: an authority `Missing`, which
/// keeps retained server rows, a shadow `Dirty`. Row counts bound
/// distinct attributes from above, so SQL selects the few documents holding
/// the fact with that many rows and Rust counts their distinct attributes.
fn mark_over_limit_incomplete(
    connection: &Db,
    tables: &Tables,
    derivation: &SortFactDerivation,
) -> Result<(), TursoStorageError> {
    let Tables {
        documents,
        exact,
        integers,
        sorts,
        optimistic,
    } = tables;
    let limit = predicate_index::MAX_ATTRIBUTES_PER_DOCUMENT;
    let candidates = driver::query(
        connection,
        &format!(
            "SELECT s.document_id FROM {sorts} AS s WHERE s.attribute = ?1 AND (SELECT COUNT(*) FROM {exact} AS c WHERE c.document_id = s.document_id) + (SELECT COUNT(*) FROM {integers} AS c WHERE c.document_id = s.document_id) + (SELECT COUNT(*) FROM {sorts} AS c WHERE c.document_id = s.document_id) > {limit}"
        ),
        vec![text(derivation.target)],
    )?;
    for row in candidates {
        let document_id = required_i64(&row, 0)?;
        let mut attributes = BTreeSet::new();
        for table in [exact, integers, sorts] {
            for row in driver::query(
                connection,
                &format!("SELECT DISTINCT attribute FROM {table} WHERE document_id = ?1"),
                vec![Value::from_i64(document_id)],
            )? {
                attributes.insert(required_text(&row, 0)?);
            }
        }
        if attributes.len() <= limit {
            continue;
        }
        let missing = projection_state_code(ProjectionIncompleteKind::Missing);
        let dirty = projection_state_code(ProjectionIncompleteKind::Dirty);
        if *optimistic {
            driver::execute(
                connection,
                &format!("UPDATE {documents} SET state = ?2, incomplete_kind = ?3 WHERE id = ?1"),
                vec![
                    Value::from_i64(document_id),
                    Value::from_i64(OptimisticIndexDocumentState::Incomplete as i64),
                    Value::from_i64(dirty),
                ],
            )?;
        } else {
            driver::execute(
                connection,
                &format!("UPDATE {documents} SET state = ?2 WHERE id = ?1"),
                vec![Value::from_i64(document_id), Value::from_i64(missing)],
            )?;
        }
        for table in [exact, integers, sorts] {
            driver::execute(
                connection,
                &format!("DELETE FROM {table} WHERE document_id = ?1"),
                vec![Value::from_i64(document_id)],
            )?;
        }
    }
    Ok(())
}
