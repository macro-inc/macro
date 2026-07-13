use model::document::modification_data::PdfModificationData;
use sqlx::Pool;
use sqlx::Postgres;
use sqlx::postgres::PgPoolOptions;

async fn test_highlight_deserialization(pool: &Pool<Postgres>) {
    let modification_data_rows: Vec<Result<PdfModificationData, anyhow::Error>> = sqlx::query!(
        r#"
        SELECT "modificationData" as "modification_data"
        FROM "DocumentInstanceModificationData"
        "#
    )
    .map(|row| {
        let modification_data = row.modification_data;
        serde_json::from_value(modification_data.clone()).map_err(|e| {
            anyhow::anyhow!(
                "Failed to deserialize modification data {:?} with data: {:?}",
                e,
                modification_data
            )
        })
    })
    .fetch_all(pool)
    .await
    .expect("Failed to fetch data from database");

    let expected_highlight_map_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*)
        FROM "DocumentInstanceModificationData" dimd
        WHERE 
        dimd."modificationData" -> 'highlights' IS NOT NULL
        AND jsonb_typeof(dimd."modificationData" -> 'highlights') = 'object'
        AND dimd."modificationData" -> 'highlights' != '{}';
        "#
    )
    .fetch_one(pool)
    .await
    .expect("Failed to fetch data from database")
    .unwrap_or_else(|| panic!("Failed to fetch data from database"));

    let mut highlight_map_count = 0;
    for row in modification_data_rows {
        match &row {
            Ok(pdf_modification_data) => {
                let highlight_map = pdf_modification_data.clone().highlights;
                if let Some(map) = highlight_map
                    && map.into_keys().count() > 0
                {
                    highlight_map_count += 1;
                }
            }
            Err(e) => {
                panic!("{:?}", e);
            }
        }
    }

    println!("Expected {} highlight maps", expected_highlight_map_count);
    println!("Deserialized {} highlight maps", highlight_map_count);
    assert_eq!(highlight_map_count, expected_highlight_map_count);
}

#[tokio::main]
async fn main() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    // Connect to database
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to the database");

    test_highlight_deserialization(&pool).await;
}
