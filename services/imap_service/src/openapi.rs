use utoipa::OpenApi;
fn main() -> Result<(), rootcause::Report> {
    println!(
        "{}",
        imap_engine::inbound::http::ApiDoc::openapi().to_pretty_json()?
    );
    Ok(())
}
