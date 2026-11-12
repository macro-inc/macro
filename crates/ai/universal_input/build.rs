use sha2::{Digest, Sha256};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

fn sources(directory: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            if entry.file_name() != "test" {
                sources(&path, files)?;
            }
        } else if path.extension().is_some_and(|extension| extension == "rs")
            && entry.file_name() != "test.rs"
        {
            files.push(path);
        }
    }
    Ok(())
}

fn main() -> io::Result<()> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    println!("cargo:rerun-if-changed=prompts");
    println!("cargo:rerun-if-changed=src");
    let mut files = fs::read_dir(root.join("prompts"))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<io::Result<Vec<_>>>()?;
    files.retain(|file| file.extension().is_some_and(|extension| extension == "txt"));
    files.sort();
    let mut hash = Sha256::new();
    for file in files {
        let name = file
            .file_name()
            .ok_or_else(|| io::Error::other("prompt has no filename"))?;
        hash.update(name.as_encoded_bytes());
        hash.update([0]);
        hash.update(fs::read(file)?);
        hash.update([0]);
    }
    let prompt_version = format!("{:x}", hash.finalize());
    println!("cargo:rustc-env=UNIVERSAL_INPUT_PROMPT_VERSION={prompt_version}");
    let mut files = vec![root.join("build.rs")];
    sources(&root.join("src"), &mut files)?;
    files.sort();
    let mut hash = Sha256::new();
    hash.update(prompt_version);
    for file in files {
        let relative = file.strip_prefix(root).map_err(io::Error::other)?;
        hash.update(relative.as_os_str().as_encoded_bytes());
        hash.update([0]);
        hash.update(fs::read(file)?);
        hash.update([0]);
    }
    println!(
        "cargo:rustc-env=UNIVERSAL_INPUT_RECIPE_VERSION={:x}",
        hash.finalize()
    );
    Ok(())
}
