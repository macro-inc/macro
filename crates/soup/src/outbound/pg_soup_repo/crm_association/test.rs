use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use system_properties::SystemPropertyKey;

const COMPANY: Uuid = Uuid::from_u128(0xc0);
const CONTACT: Uuid = Uuid::from_u128(0xc1);
const OTHER: Uuid = Uuid::from_u128(0xc2);

async fn link(pool: &PgPool, entity_id: &str, entity_type: &str, definition: Uuid, ids: &[Uuid]) {
    let refs: Vec<Value> = ids
        .iter()
        .map(|id| json!({ "entity_id": id.to_string(), "entity_type": "COMPANY" }))
        .collect();
    sqlx::query!(
        r#"INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
           VALUES ($1, $2, $3::text::property_entity_type, $4, $5)"#,
        Uuid::now_v7(),
        entity_id,
        entity_type,
        definition,
        json!({ "type": "EntityReference", "value": refs }),
    )
    .execute(pool)
    .await
    .unwrap();
}

/// An entity reference value naming each `(entity type, id)`.
fn references(targets: &[(&str, Uuid)]) -> Value {
    let refs: Vec<Value> = targets
        .iter()
        .map(|(entity_type, id)| json!({ "entity_id": id.to_string(), "entity_type": entity_type }))
        .collect();
    json!({ "type": "EntityReference", "value": refs })
}

/// A new database with one table.
async fn table(pool: &PgPool) -> (Uuid, Uuid) {
    let database = Uuid::now_v7();
    let table = Uuid::now_v7();
    sqlx::query!("INSERT INTO databases (id) VALUES ($1)", database)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, $3, '80')",
        table,
        database,
        table.to_string(),
    )
    .execute(pool)
    .await
    .unwrap();
    (database, table)
}

/// A column of `data_type`, owned by `database` and placed in `table`.
async fn column(pool: &PgPool, database: Uuid, table: Uuid, data_type: &str) -> Uuid {
    let definition = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO property_definitions (id, display_name, data_type, is_multi_select, database_id)
         VALUES ($1, $2, $3::text::property_data_type, TRUE, $4)",
        definition,
        definition.to_string(),
        data_type,
        database,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO database_columns (id, table_id, property_definition_id, position)
         VALUES ($1, $2, $3, '80')",
        Uuid::now_v7(),
        table,
        definition,
    )
    .execute(pool)
    .await
    .unwrap();
    definition
}

async fn row(pool: &PgPool, table: Uuid) -> Uuid {
    let row = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO database_rows (id, table_id, position) VALUES ($1, $2, '80')",
        row,
        table,
    )
    .execute(pool)
    .await
    .unwrap();
    row
}

/// A row cell, checked by the cell triggers like every stored cell.
async fn cell(pool: &PgPool, row: Uuid, definition: Uuid, value: Value) {
    sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
         VALUES ($1, $2, 'DATABASE_ROW', $3, $4)",
        Uuid::now_v7(),
        row.to_string(),
        definition,
        value,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A row cell written around the cell triggers, standing for rows the
/// triggers never saw.
async fn unchecked_cell(pool: &PgPool, entity_id: &str, definition: Uuid, value: Value) {
    let mut transaction = pool.begin().await.unwrap();
    sqlx::query!("SET LOCAL session_replication_role = replica")
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
         VALUES ($1, $2, 'DATABASE_ROW', $3, $4)",
        Uuid::now_v7(),
        entity_id,
        definition,
        value,
    )
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();
}

fn row_edges(rows: &[Uuid]) -> Vec<CrmPropertyEdge> {
    let mut edges: Vec<CrmPropertyEdge> = rows
        .iter()
        .map(|row| CrmPropertyEdge {
            entity_type: EntityType::DatabaseRow,
            entity_id: row.to_string(),
        })
        .collect();
    edges.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    edges
}

async fn sorted_edges(
    pool: &PgPool,
    companies: &[Uuid],
    contacts: &[Uuid],
) -> Vec<CrmPropertyEdge> {
    let mut edges = property_edges(pool, companies, contacts).await.unwrap();
    edges.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    edges
}

#[test]
fn literal_property_ids_are_the_system_properties() {
    let sql = include_str!("../crm_association.rs");
    assert!(sql.contains(&SystemPropertyKey::COMPANIES_UUID.to_string()));
    assert!(sql.contains(&SystemPropertyKey::CONTACTS_UUID.to_string()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn matches_companies_and_contacts_once(pool: PgPool) {
    let companies = SystemPropertyKey::COMPANIES_UUID;
    let contacts = SystemPropertyKey::CONTACTS_UUID;
    link(&pool, "task-company", "TASK", companies, &[OTHER, COMPANY]).await;
    link(&pool, "call-contact", "CALL_RECORD", contacts, &[CONTACT]).await;
    // Both properties on one entity still produce one edge.
    link(&pool, "doc-both", "DOCUMENT", companies, &[COMPANY]).await;
    link(&pool, "doc-both", "DOCUMENT", contacts, &[CONTACT]).await;
    // A contact id in the Companies property, or another record, never matches.
    link(
        &pool,
        "doc-wrong-property",
        "DOCUMENT",
        companies,
        &[CONTACT],
    )
    .await;
    link(&pool, "doc-other", "DOCUMENT", contacts, &[OTHER]).await;

    let mut edges = property_edges(&pool, &[COMPANY], &[CONTACT]).await.unwrap();
    edges.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    assert_eq!(
        edges,
        vec![
            CrmPropertyEdge {
                entity_type: EntityType::CallRecord,
                entity_id: "call-contact".into()
            },
            CrmPropertyEdge {
                entity_type: EntityType::Document,
                entity_id: "doc-both".into()
            },
            CrmPropertyEdge {
                entity_type: EntityType::Task,
                entity_id: "task-company".into()
            },
        ]
    );
    assert!(property_edges(&pool, &[], &[]).await.unwrap().is_empty());
    assert_eq!(
        property_edges(&pool, &[], &[CONTACT]).await.unwrap().len(),
        2
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn matches_database_rows_whose_entity_cells_reference_a_record(pool: PgPool) {
    let (database, deals) = table(&pool).await;
    let account = column(&pool, database, deals, "ENTITY").await;
    let champion = column(&pool, database, deals, "ENTITY").await;
    let notes = column(&pool, database, deals, "STRING").await;

    // Several references in one cell, and two cells of one row: one edge.
    let both = row(&pool, deals).await;
    cell(
        &pool,
        both,
        account,
        references(&[("COMPANY", OTHER), ("COMPANY", COMPANY)]),
    )
    .await;
    cell(&pool, both, champion, references(&[("CONTACT", CONTACT)])).await;
    let contact_only = row(&pool, deals).await;
    cell(
        &pool,
        contact_only,
        champion,
        references(&[("CONTACT", CONTACT)]),
    )
    .await;
    // The company's id typed as a contact names no requested record.
    let mistyped = row(&pool, deals).await;
    cell(
        &pool,
        mistyped,
        account,
        references(&[("CONTACT", COMPANY)]),
    )
    .await;
    // A reference held by a column that is not an entity column.
    let text = row(&pool, deals).await;
    cell(&pool, text, notes, references(&[("COMPANY", COMPANY)])).await;
    // Another database, whoever owns it, counts like the first.
    let (elsewhere_database, elsewhere_table) = table(&pool).await;
    let elsewhere_account = column(&pool, elsewhere_database, elsewhere_table, "ENTITY").await;
    let elsewhere = row(&pool, elsewhere_table).await;
    cell(
        &pool,
        elsewhere,
        elsewhere_account,
        references(&[("COMPANY", COMPANY)]),
    )
    .await;
    // A cell of a definition its row's table does not place.
    let unplaced = row(&pool, deals).await;
    unchecked_cell(
        &pool,
        &unplaced.to_string(),
        elsewhere_account,
        references(&[("COMPANY", COMPANY)]),
    )
    .await;

    assert_eq!(
        sorted_edges(&pool, &[COMPANY], &[CONTACT]).await,
        row_edges(&[both, contact_only, elsewhere])
    );
    assert_eq!(
        sorted_edges(&pool, &[COMPANY], &[]).await,
        row_edges(&[both, elsewhere])
    );
    assert_eq!(
        sorted_edges(&pool, &[], &[CONTACT]).await,
        row_edges(&[both, contact_only])
    );
    // OTHER is named as a company only.
    assert_eq!(
        sorted_edges(&pool, &[OTHER], &[OTHER]).await,
        row_edges(&[both])
    );
}

/// The statement before database row cells were found through
/// `idx_ep_database_row_references_gin`: every entity cell of every database,
/// expanded and compared. The equivalence test holds the new statement to it.
async fn full_scan_edges(
    pool: &PgPool,
    company_ids: &[Uuid],
    contact_ids: &[Uuid],
) -> Vec<CrmPropertyEdge> {
    let company_ids: Vec<String> = company_ids.iter().map(Uuid::to_string).collect();
    let contact_ids: Vec<String> = contact_ids.iter().map(Uuid::to_string).collect();
    let mut edges: Vec<CrmPropertyEdge> = sqlx::query!(
        r#"
        SELECT ep.entity_type AS "entity_type!: EntityType", ep.entity_id AS "entity_id!"
        FROM UNNEST($1::text[]) AS company(id)
        JOIN entity_properties ep
            ON ep.property_definition_id = '00000001-0000-0000-0000-00000000000c'
           AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', company.id))
        UNION
        SELECT ep.entity_type, ep.entity_id
        FROM UNNEST($2::text[]) AS contact(id)
        JOIN entity_properties ep
            ON ep.property_definition_id = '00000001-0000-0000-0000-000000000013'
           AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', contact.id))
        UNION
        SELECT ep.entity_type, ep.entity_id
        FROM database_columns dc
        JOIN property_definitions pd
            ON pd.id = dc.property_definition_id AND pd.data_type = 'ENTITY'
        JOIN entity_properties ep
            ON ep.property_definition_id = dc.property_definition_id
           AND ep.entity_type = 'DATABASE_ROW'
        JOIN database_rows r
            ON r.id::text = ep.entity_id AND r.table_id = dc.table_id
        WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(ep.values->'value') = 'array'
                    THEN ep.values->'value' ELSE '[]'::jsonb END
            ) AS reference
            WHERE (reference->>'entity_type' = 'COMPANY'
                   AND reference->>'entity_id' = ANY($1::text[]))
               OR (reference->>'entity_type' = 'CONTACT'
                   AND reference->>'entity_id' = ANY($2::text[]))
        )
        "#,
        &company_ids,
        &contact_ids,
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| CrmPropertyEdge {
        entity_type: row.entity_type,
        entity_id: row.entity_id,
    })
    .collect();
    edges.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    edges
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn database_row_edges_equal_the_full_scan(pool: PgPool) {
    let companies: Vec<Uuid> = (0..6).map(|n| Uuid::from_u128(0xc0_0000 + n)).collect();
    let contacts: Vec<Uuid> = (0..6).map(|n| Uuid::from_u128(0xc1_0000 + n)).collect();
    let target = |n: usize| -> (&'static str, Uuid) {
        match n % 4 {
            0 => ("COMPANY", companies[n % companies.len()]),
            1 => ("CONTACT", contacts[n % contacts.len()]),
            // A record id under the other record type.
            2 => ("CONTACT", companies[n % companies.len()]),
            _ => ("DOCUMENT", contacts[n % contacts.len()]),
        }
    };
    let mut rows = Vec::new();
    for database_number in 0..3 {
        let (database, table_id) = table(&pool).await;
        let entity = column(&pool, database, table_id, "ENTITY").await;
        let second_entity = column(&pool, database, table_id, "ENTITY").await;
        let text = column(&pool, database, table_id, "STRING").await;
        let select = column(&pool, database, table_id, "SELECT_STRING").await;
        let link = column(&pool, database, table_id, "LINK").await;
        for n in 0..24 {
            let seed = database_number * 24 + n;
            let row_id = row(&pool, table_id).await;
            rows.push(row_id);
            let several: Vec<(&str, Uuid)> =
                (0..(seed % 3)).map(|k| target(seed + k * 5)).collect();
            cell(&pool, row_id, entity, references(&several)).await;
            if seed % 2 == 0 {
                cell(
                    &pool,
                    row_id,
                    second_entity,
                    references(&[target(seed + 1)]),
                )
                .await;
            }
            if seed % 5 == 0 {
                cell(&pool, row_id, text, references(&[target(seed)])).await;
            }
            // Record ids as option and link strings name no record.
            cell(
                &pool,
                row_id,
                select,
                json!({ "type": "SelectOption", "value": [companies[seed % 6].to_string()] }),
            )
            .await;
            cell(
                &pool,
                row_id,
                link,
                json!({ "type": "Link", "value": [contacts[seed % 6].to_string()] }),
            )
            .await;
        }
        // Cells the triggers would refuse: an entity id that is not a row
        // id's canonical text, and a definition the row's table doesn't place.
        let odd = rows[rows.len() - 1].to_string();
        for entity_id in [odd.to_uppercase(), format!("{{{odd}}}"), "not-a-row".into()] {
            unchecked_cell(&pool, &entity_id, entity, references(&[target(0)])).await;
        }
        let (_, other_table) = table(&pool).await;
        let stray = row(&pool, other_table).await;
        unchecked_cell(&pool, &stray.to_string(), entity, references(&[target(0)])).await;
    }

    let mut cases: Vec<(Vec<Uuid>, Vec<Uuid>)> = vec![
        (companies.clone(), contacts.clone()),
        (companies.clone(), vec![]),
        (vec![], contacts.clone()),
        (companies[..2].to_vec(), contacts[3..].to_vec()),
        (vec![OTHER], vec![OTHER]),
    ];
    cases.extend((0..6).map(|n| (vec![companies[n]], vec![contacts[n]])));
    let mut matched = 0;
    for (company_ids, contact_ids) in cases {
        let expected = full_scan_edges(&pool, &company_ids, &contact_ids).await;
        matched += expected.len();
        assert_eq!(
            sorted_edges(&pool, &company_ids, &contact_ids).await,
            expected,
            "companies {company_ids:?}, contacts {contact_ids:?}"
        );
    }
    // The cases exercise matches, not only empty results.
    assert!(matched > rows.len(), "only {matched} edges matched");
}
