use sqlx::{Postgres, Transaction};

use model::document::{BomPart, SaveBomPart};

pub(in crate::document) async fn create_bom_parts(
    transaction: &mut Transaction<'_, Postgres>,
    document_bom_id: i64,
    bom_parts: Vec<SaveBomPart>,
) -> anyhow::Result<Vec<BomPart>> {
    if bom_parts.is_empty() {
        return Ok(Vec::new());
    }
    let mut query =
        "INSERT INTO \"BomPart\" (\"documentBomId\", \"sha\", \"path\") VALUES ".to_string();
    let mut set_parts: Vec<String> = Vec::new();
    let mut parameters: Vec<String> = Vec::new();

    for bom_part in &bom_parts {
        // Start counting at 2 because 1 is the document bom id
        let param_number = parameters.len() + 2;
        set_parts.push(format!("($1, ${}, ${})", param_number, param_number + 1));

        parameters.push(bom_part.sha.clone());
        parameters.push(bom_part.path.clone());
    }

    query += &set_parts.join(", ");

    query += ";";

    let mut query = sqlx::query_as::<_, BomPart>(&query);
    query = query.bind(document_bom_id);

    for param in parameters {
        query = query.bind(param);
    }

    let saved_bom_parts: Vec<BomPart> = query.fetch_all(transaction.as_mut()).await?;

    Ok(saved_bom_parts)
}
