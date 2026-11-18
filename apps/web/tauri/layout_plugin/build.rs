fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri_plugin::Builder::new(&[])
        .ios_path("ios")
        .try_build()?;
    Ok(())
}
