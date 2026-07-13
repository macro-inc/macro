use macro_db_client::document::build_pdf_modification_data::get_complete_pdf_modification_data;
use macro_db_client::document::build_pdf_modification_data::get_pdf_modification_data_for_document;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() {
    MacroEntrypoint::default().init();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    // Connect to database
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to the database");

    let document_id = "ad329053-741f-4558-a8af-207b8780587b";

    let initial_modification_data =
        get_pdf_modification_data_for_document(&pool, document_id).await;
    let initial_modification_data = initial_modification_data.unwrap();

    let full_modification_data =
        get_complete_pdf_modification_data(&pool, document_id, Some(initial_modification_data))
            .await;

    println!(
        "{}",
        serde_json::to_string(&full_modification_data.unwrap()).unwrap()
    );
}
