fn main() {
    // use bebop_tools as bebop;
    // bebop::download_bebopc(std::path::PathBuf::from("target").join("bebopc"));
    // bebop::build_schema_dir("bebop", "src/generated", &bebop::BuildConfig::default());
    include_git_in_env();
}

fn include_git_in_env() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/refs");
    let git_vers = match std::process::Command::new("git")
        .args(["describe", "--tags", "--always"])
        .output()
    {
        Ok(o) => {
            if o.status.success() {
                String::from_utf8_lossy(&o.stdout).trim().to_string()
            } else {
                // Fallback for Docker builds without .git directory
                "docker".to_string()
            }
        }
        Err(_) => {
            // Fallback when git command is not available
            "unknown".to_string()
        }
    };
    println!("cargo:rustc-env=GIT_DESCRIBE={}", git_vers);
}
