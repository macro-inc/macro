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
    sorts: &'static str,
}

const AUTHORITATIVE: Tables = Tables {
    documents: "index_documents",
    exact: "exact_facts",
    sorts: "sort_facts",
};

const OPTIMISTIC: Tables = Tables {
    documents: "optimistic_index_documents",
    exact: "optimistic_exact_facts",
    sorts: "optimistic_sort_facts",
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

fn derive(connection: &Db, derivation: &SortFactDerivation) -> Result<(), TursoStorageError> {
    for tables in [AUTHORITATIVE, OPTIMISTIC] {
        let Tables {
            documents,
            exact,
            sorts,
        } = tables;
        driver::execute(
            connection,
            &format!(
                "DELETE FROM {sorts} WHERE attribute = ?1 AND document_id IN (SELECT id FROM {documents} WHERE profile = ?2)"
            ),
            vec![text(derivation.target), text(derivation.profile)],
        )?;
        let mut parameters = vec![
            text(derivation.target),
            text(derivation.source),
            text(derivation.profile),
        ];
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
        driver::execute(
            connection,
            &format!(
                "INSERT INTO {sorts} (document_id, attribute, value) SELECT s.document_id, ?1, s.value FROM {sorts} AS s JOIN {documents} AS d ON d.id = s.document_id WHERE s.attribute = ?2 AND d.profile = ?3{required}"
            ),
            parameters,
        )?;
    }
    // An optimistic row that cannot vouch for its source value cannot vouch
    // for the copy either.
    driver::execute(
        connection,
        "DELETE FROM optimistic_uncertain_attributes WHERE attribute = ?1 AND document_id IN (SELECT id FROM optimistic_index_documents WHERE profile = ?2)",
        vec![text(derivation.target), text(derivation.profile)],
    )?;
    driver::execute(
        connection,
        "INSERT INTO optimistic_uncertain_attributes (document_id, attribute) SELECT u.document_id, ?1 FROM optimistic_uncertain_attributes AS u JOIN optimistic_index_documents AS d ON d.id = u.document_id WHERE u.attribute = ?2 AND d.profile = ?3",
        vec![
            text(derivation.target),
            text(derivation.source),
            text(derivation.profile),
        ],
    )?;
    Ok(())
}
