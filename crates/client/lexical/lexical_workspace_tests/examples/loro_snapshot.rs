//! Emit a deterministic Rust snapshot for the JavaScript import check.

fn main() -> Result<(), rootcause::Report> {
    let doc = loro::LoroDoc::new();
    doc.set_peer_id(1)?;
    doc.get_text("text").insert(0, "snapshot Σ𐐀")?;
    let snapshot = doc.export(loro::ExportMode::Snapshot)?;
    println!("{}", serde_json::to_string(&snapshot)?);
    Ok(())
}
