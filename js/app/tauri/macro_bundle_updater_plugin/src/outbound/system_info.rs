use semver::Version;
use tauri::{Manager, Runtime};

use crate::domain::{
    models::{AppInfo, Arch, Target},
    ports::SystemQuery,
};

pub struct SystemInfo<R: Runtime> {
    app_handle: tauri::AppHandle<R>,
}

impl<R: Runtime> SystemInfo<R> {
    pub fn new(app_handle: tauri::AppHandle<R>) -> Self {
        Self { app_handle }
    }

    fn get_target(&self) -> Target {
        match std::env::consts::OS {
            "linux" => Target::Linux,
            "windows" => Target::Windows,
            "macos" => Target::Darwin,
            "ios" => Target::Ios,
            "android" => Target::Android,
            x => unreachable!("Encountered unknown target: {x}"),
        }
    }

    fn get_version(&self) -> Version {
        self.app_handle.package_info().version.clone()
    }

    fn get_arch(&self) -> Arch {
        match std::env::consts::ARCH {
            "aarch64" => Arch::Aarch64,
            "armv7" => Arch::Armv7,
            "x86_64" => Arch::X86_64,
            "i686" => Arch::I686,
            x => unreachable!("Encountered unknown arch: {x}"),
        }
    }
}

impl<R: Runtime> SystemQuery for SystemInfo<R> {
    async fn get_system_info(&self) -> Result<AppInfo, rootcause::Report> {
        Ok(AppInfo {
            current_version: self.get_version(),
            arch: self.get_arch(),
            target: self.get_target(),
        })
    }

    async fn get_update_dir(&self) -> Result<std::path::PathBuf, std::io::Error> {
        self.app_handle
            .path()
            .app_cache_dir()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))
    }
}
