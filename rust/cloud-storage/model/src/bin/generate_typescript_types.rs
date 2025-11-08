use model::document::FileType;
use std::{fs::File, io::Write};

fn main() -> std::io::Result<()> {
    let mut file = File::create("generated/fileTypeMap.ts")?;

    writeln!(file, "export const FileTypeMap = {{")?;

    for ft in FileType::all() {
        let key = serde_json::to_string(ft).unwrap();
        let ext = ft.as_str();
        let mime = ft.mime_type();
        let app = ft.macro_app_path();
        writeln!(
            file,
            r#"  {key}: {{ extension: "{ext}", mime: "{mime}", app: "{app}" }},"#
        )?;
    }

    writeln!(file, "}} as const;\n")?;

    println!("✅ Generated typescript types for FileType");
    Ok(())
}
