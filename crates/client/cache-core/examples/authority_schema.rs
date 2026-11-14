//! Print shared permission-generation transport schemas for frontend generation.
fn main() -> Result<(), serde_json::Error> {
    println!(
        "{}",
        serde_json::to_string_pretty(&cache_core::engine::authority::transport_schemas())?
    );
    Ok(())
}
