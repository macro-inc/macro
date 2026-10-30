use std::{
    env,
    error::Error,
    fs::{self, File},
    io::{self, Cursor, Read, Seek},
    path::{Path, PathBuf},
};

use regex::Regex;
use zip::{result::ZipError, ZipArchive};

/// the following env variables control the build process:
/// 1. SWAGGER_UI_DOWNLOAD_URL:
/// + the url from where to download the swagger-ui zip file if starts with http:// or https://
/// + the file path from where to copy the swagger-ui zip file if starts with file://
/// + default value is SWAGGER_UI_DOWNLOAD_URL_DEFAULT
/// + for other versions, check https://github.com/swagger-api/swagger-ui/tags
/// 2. SWAGGER_UI_OVERWRITE_FOLDER
/// + absolute path to a folder containing files to overwrite the default swagger-ui files

const SWAGGER_UI_DOWNLOAD_URL_DEFAULT: &str =
    "https://github.com/swagger-api/swagger-ui/archive/refs/tags/v5.17.14.zip";

const SWAGGER_UI_DOWNLOAD_URL: &str = "SWAGGER_UI_DOWNLOAD_URL";
const SWAGGER_UI_OVERWRITE_FOLDER: &str = "SWAGGER_UI_OVERWRITE_FOLDER";

#[cfg(feature = "cache")]
fn sha256(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash = hasher.finalize();
    format!("{:x}", hash).to_uppercase()
}

#[cfg(feature = "cache")]
fn get_cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|p| p.join("utoipa-swagger-ui"))
}

fn main() {
    let target_dir = env::var("OUT_DIR").unwrap();
    println!("OUT_DIR: {target_dir}");

    let url =
        env::var(SWAGGER_UI_DOWNLOAD_URL).unwrap_or(SWAGGER_UI_DOWNLOAD_URL_DEFAULT.to_string());

    println!("{SWAGGER_UI_DOWNLOAD_URL}: {url}");

    let mut swagger_zip = get_zip_archive(&url, &target_dir);
    let zip_top_level_folder = swagger_zip
        .extract_dist(&target_dir)
        .expect("should extract dist");
    println!("zip_top_level_folder: {:?}", zip_top_level_folder);

    replace_default_url_with_config(&target_dir, &zip_top_level_folder);

    write_embed_code(&target_dir, &zip_top_level_folder);

    let overwrite_folder =
        PathBuf::from(env::var(SWAGGER_UI_OVERWRITE_FOLDER).unwrap_or("overwrite".to_string()));

    if overwrite_folder.exists() {
        println!("{SWAGGER_UI_OVERWRITE_FOLDER}: {overwrite_folder:?}");

        for entry in fs::read_dir(overwrite_folder).unwrap() {
            let entry = entry.unwrap();
            let path_in = entry.path();
            println!("replacing file: {:?}", path_in.clone());
            overwrite_target_file(&target_dir, &zip_top_level_folder, path_in);
        }
    } else {
        println!("{SWAGGER_UI_OVERWRITE_FOLDER} not found: {overwrite_folder:?}");
    }
}

enum SwaggerZip {
    #[allow(unused)]
    Bytes(ZipArchive<Cursor<&'static [u8]>>),
    File(ZipArchive<File>),
}

impl SwaggerZip {
    fn extract_dist(&mut self, target_dir: &str) -> Result<String, ZipError> {
        // Inner function that's generic over the type of zip files
        fn extract<R: Seek + Read>(
            zip: &mut ZipArchive<R>,
            target_dir: &str,
        ) -> Result<String, ZipError> {
            let mut zip_top_level_folder = String::new();

            for index in 0..zip.len() {
                let mut file = zip.by_index(index)?;
                let filepath = file
                    .enclosed_name()
                    .ok_or(ZipError::InvalidArchive("invalid path file".into()))?;

                if index == 0 {
                    zip_top_level_folder = filepath
                        .iter()
                        .take(1)
                        .map(|x| x.to_str().unwrap_or_default())
                        .collect::<String>();
                }

                let next_folder = filepath
                    .iter()
                    .skip(1)
                    .take(1)
                    .map(|x| x.to_str().unwrap_or_default())
                    .collect::<String>();

                if next_folder == "dist" {
                    let directory = [&target_dir].iter().collect::<PathBuf>();
                    let out_path = directory.join(filepath);

                    if file.name().ends_with('/') {
                        fs::create_dir_all(&out_path)?;
                    } else {
                        if let Some(p) = out_path.parent() {
                            if !p.exists() {
                                fs::create_dir_all(p)?;
                            }
                        }
                        let mut out_file = fs::File::create(&out_path)?;
                        io::copy(&mut file, &mut out_file)?;
                    }
                    // Get and Set permissions
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if let Some(mode) = file.unix_mode() {
                            fs::set_permissions(&out_path, fs::Permissions::from_mode(mode))?;
                        }
                    }
                }
            }

            Ok(zip_top_level_folder)
        }

        match self {
            Self::File(file) => extract(file, target_dir),
            Self::Bytes(bytes) => extract(bytes, target_dir),
        }
    }
}

fn get_zip_archive(url: &str, target_dir: &str) -> SwaggerZip {
    let zip_filename = url.split('/').last().unwrap().to_string();
    #[allow(unused_mut)]
    let mut zip_path = [target_dir, &zip_filename].iter().collect::<PathBuf>();

    if env::var("CARGO_FEATURE_VENDORED").is_ok() {
        #[cfg(not(feature = "vendored"))]
        unreachable!("Cannot get vendored Swagger UI without `vendored` flag");

        #[cfg(feature = "vendored")]
        {
            println!("using vendored Swagger UI");
            let vendred_bytes = utoipa_swagger_ui_vendored::SWAGGER_UI_VENDORED;
            let zip = ZipArchive::new(io::Cursor::new(vendred_bytes))
                .expect("failed to open vendored Swagger UI");
            SwaggerZip::Bytes(zip)
        }
    } else if url.starts_with("file:") {
        #[cfg(feature = "url")]
        let mut file_path = url::Url::parse(url).unwrap().to_file_path().unwrap();
        #[cfg(not(feature = "url"))]
        let mut file_path = {
            use std::str::FromStr;
            PathBuf::from_str(url).unwrap()
        };
        file_path = fs::canonicalize(file_path).expect("swagger ui download path should exists");

        // with file protocol utoipa swagger ui should compile when file changes
        println!("cargo:rerun-if-changed={:?}", file_path);

        println!("start copy to : {:?}", zip_path);
        fs::copy(file_path, zip_path.clone()).unwrap();

        let swagger_ui_zip =
            File::open([target_dir, &zip_filename].iter().collect::<PathBuf>()).unwrap();
        let zip = ZipArchive::new(swagger_ui_zip)
            .expect("failed to open file protocol copied Swagger UI");
        SwaggerZip::File(zip)
    } else if url.starts_with("http://") || url.starts_with("https://") {
        // with http protocol we update when the 'SWAGGER_UI_DOWNLOAD_URL' changes
        println!("cargo:rerun-if-env-changed={SWAGGER_UI_DOWNLOAD_URL}");

        // Update zip_path to point to the resolved cache directory
        #[cfg(feature = "cache")]
        {
            // Compute cache key based hashed URL + crate version
            let mut cache_key = String::new();
            cache_key.push_str(url);
            cache_key.push_str(&env::var("CARGO_PKG_VERSION").unwrap_or_default());
            let cache_key = sha256(cache_key.as_bytes());
            // Store the cache in the cache_key directory inside the OS's default cache folder
            let mut cache_dir = if let Some(dir) = get_cache_dir() {
                dir.join("swagger-ui").join(&cache_key)
            } else {
                println!("cargo:warning=Could not determine cache directory, using OUT_DIR");
                PathBuf::from(env::var("OUT_DIR").unwrap())
            };
            if fs::create_dir_all(&cache_dir).is_err() {
                cache_dir = env::var("OUT_DIR").unwrap().into();
            }
            zip_path = cache_dir.join(&zip_filename);
        }

        if zip_path.exists() {
            println!("using cached zip path from : {:?}", zip_path);
        } else {
            println!("start download to : {:?}", zip_path);
            download_file(url, zip_path.clone()).expect("failed to download Swagger UI");
        }
        let swagger_ui_zip = File::open(zip_path).unwrap();
        let zip = ZipArchive::new(swagger_ui_zip).expect("failed to open downloaded Swagger UI");
        SwaggerZip::File(zip)
    } else {
        panic!("`vendored` feature not enabled and invalid {SWAGGER_UI_DOWNLOAD_URL}: {url} -> must start with http:// | https:// | file:");
    }
}

fn replace_default_url_with_config(target_dir: &str, zip_top_level_folder: &str) {
    let regex = Regex::new(r#"(?ms)url:.*deep.*true,"#).unwrap();

    let path = [
        target_dir,
        zip_top_level_folder,
        "dist",
        "swagger-initializer.js",
    ]
    .iter()
    .collect::<PathBuf>();

    let mut swagger_initializer = fs::read_to_string(&path).unwrap();
    swagger_initializer = swagger_initializer.replace("layout: \"StandaloneLayout\"", "");

    let replaced_swagger_initializer = regex.replace(&swagger_initializer, "{{config}},");

    fs::write(&path, replaced_swagger_initializer.as_ref()).unwrap();
}

fn write_embed_code(target_dir: &str, zip_top_level_folder: &str) {
    let contents = format!(
        r#"
// This file is auto-generated during compilation, do not modify
#[derive(RustEmbed)]
#[folder = r"$OUT_DIR/{}/dist/"]
struct SwaggerUiDist;
"#,
        zip_top_level_folder
    );
    let path = [target_dir, "embed.rs"].iter().collect::<PathBuf>();
    fs::write(path, contents).unwrap();
}

fn download_file(url: &str, path: PathBuf) -> Result<(), Box<dyn Error>> {
    let reqwest_feature = env::var("CARGO_FEATURE_REQWEST");
    println!("reqwest feature: {reqwest_feature:?}");
    if reqwest_feature.is_ok() {
        #[cfg(feature = "reqwest")]
        download_file_reqwest(url, path)?;
        Ok(())
    } else {
        println!("trying to download using `curl` system package");
        download_file_curl(url, path.as_path())
    }
}

#[cfg(feature = "reqwest")]
fn download_file_reqwest(url: &str, path: PathBuf) -> Result<(), Box<dyn Error>> {
    let mut client_builder = reqwest::blocking::Client::builder();

    if let Ok(cainfo) = env::var("CARGO_HTTP_CAINFO") {
        match parse_ca_file(&cainfo) {
            Ok(cert) => client_builder = client_builder.add_root_certificate(cert),
            Err(e) => println!(
                "failed to load certificate from CARGO_HTTP_CAINFO `{cainfo}`, attempting to download without it. Error: {e:?}",
            ),
        }
    }

    let client = client_builder.build()?;

    let mut response = client.get(url).send()?;
    let mut file = File::create(path)?;
    io::copy(&mut response, &mut file)?;
    Ok(())
}

#[cfg(feature = "reqwest")]
fn parse_ca_file(path: &str) -> Result<reqwest::Certificate, Box<dyn Error>> {
    let mut buf = Vec::new();
    use io::Read;
    File::open(path)?.read_to_end(&mut buf)?;
    let cert = reqwest::Certificate::from_pem(&buf)?;
    Ok(cert)
}

fn download_file_curl<T: AsRef<Path>>(url: &str, target_dir: T) -> Result<(), Box<dyn Error>> {
    // Not using `CARGO_CFG_TARGET_OS` because of the possibility of cross-compilation.
    // When targeting `x86_64-pc-windows-gnu` on Linux for example, `cfg!()` in the
    // build script still reports `target_os = "linux"`, which is desirable.
    let curl_bin_name = if cfg!(target_os = "windows") {
        // powershell aliases `curl` to `Invoke-WebRequest`
        "curl.exe"
    } else {
        "curl"
    };

    #[cfg(feature = "url")]
    let url = url::Url::parse(url)?;

    let mut args = Vec::with_capacity(6);
    args.extend([
        "-sSL",
        "-o",
        target_dir
            .as_ref()
            .as_os_str()
            .to_str()
            .expect("target dir should be valid utf-8"),
        #[cfg(feature = "url")]
        {
            url.as_str()
        },
        #[cfg(not(feature = "url"))]
        url,
    ]);
    let cacert = env::var("CARGO_HTTP_CAINFO").unwrap_or_default();
    if !cacert.is_empty() {
        args.extend(["--cacert", &cacert]);
    }

    let download = std::process::Command::new(curl_bin_name)
        .args(args)
        .spawn()
        .and_then(|mut child| child.wait());

    Ok(download
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(std::io::Error::new(
                    io::ErrorKind::Other,
                    format!("curl download file exited with error status: {status}"),
                ))
            }
        })
        .map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                io::Error::new(error.kind(), format!("`{curl_bin_name}` command not found"))
            } else {
                error
            }
        })
        .map_err(Box::new)?)
}

fn overwrite_target_file(target_dir: &str, swagger_ui_dist_zip: &str, path_in: PathBuf) {
    let filename = path_in.file_name().unwrap().to_str().unwrap();
    println!("overwrite file: {:?}", path_in.file_name().unwrap());

    let content = fs::read(path_in.clone());

    match content {
        Ok(content) => {
            let path = [target_dir, swagger_ui_dist_zip, "dist", filename]
                .iter()
                .collect::<PathBuf>();

            fs::write(path, content).unwrap();
        }
        Err(_) => {
            println!("cannot read content from file: {:?}", path_in);
        }
    }
}
