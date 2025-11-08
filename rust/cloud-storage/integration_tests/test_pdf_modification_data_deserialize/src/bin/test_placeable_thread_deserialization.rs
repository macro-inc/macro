use model::document::modification_data::Payload;
use model::document::modification_data::PdfModificationData;
use sqlx::Pool;
use sqlx::Postgres;
use sqlx::postgres::PgPoolOptions;

async fn test_placeable_thread_deserialization(pool: &Pool<Postgres>) {
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

    let expected_thread_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*)
        FROM "DocumentInstanceModificationData",
            jsonb_array_elements("modificationData"->'placeables') AS placeable
        WHERE placeable->>'payloadType' = 'thread';
        "#
    )
    .fetch_one(pool)
    .await
    .expect("Failed to fetch data from database")
    .unwrap_or_else(|| panic!("Failed to fetch data from database"));

    let mut thread_count = 0;
    for row in modification_data_rows {
        match &row {
            Ok(pdf_modification_data) => {
                let placeables = pdf_modification_data.clone().placeables;
                for placeable in placeables {
                    if let Payload::Thread(ref _thread) = placeable.payload {
                        // println!("Thread placeable: {:?}", placeable);
                        thread_count += 1;
                    }
                }
            }
            Err(e) => {
                panic!("{:?}", e);
            }
        }
    }

    println!("Expected {} threads", expected_thread_count);
    println!("Deserialized {} threads", thread_count);
    assert_eq!(thread_count, expected_thread_count);
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

    test_placeable_thread_deserialization(&pool).await;
}
