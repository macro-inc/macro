use semver::Version;
use tauri::{Manager, Runtime};
use tauri_plugin_device_info::DeviceInfoExt;

use crate::domain::{
    models::{AppInfo, Arch, Target},
    ports::SystemQuery,
};

/// Queries the running Tauri app for version, architecture, and OS target.
pub struct SystemInfo<R: Runtime> {
    app_handle: tauri::AppHandle<R>,
}

impl<R: Runtime> SystemInfo<R> {
    /// Create a new system info query bound to the given app handle.
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

    async fn get_version(&self) -> Version {
        // If an OTA update has been applied, read the version from semver.txt
        // in the bundle root so the server can compare build metadata accurately.
        if let Some(s) = self
            .app_handle
            .try_state::<tokio::sync::Mutex<crate::inbound::plugin::PluginService>>()
        {
            let service = s.lock().await;
            if let Some(v) = service.bundle_version().await {
                return v;
            }
        }
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
            current_version: self.get_version().await,
            arch: self.get_arch(),
            target: self.get_target(),
        })
    }

    async fn get_network_type(&self) -> Result<Option<String>, rootcause::Report> {
        let network_info = self
            .app_handle
            .device_info()
            .get_network_info()
            .map_err(|e| rootcause::report!("Failed to read network info: {e}"))?;
        Ok(network_info.network_type)
    }

    async fn get_update_dir(&self) -> Result<std::path::PathBuf, std::io::Error> {
        self.app_handle
            .path()
            .app_cache_dir()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))
    }
}
