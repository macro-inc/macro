use tauri::{Manager, Runtime};
use tauri_plugin_device_info::DeviceInfoExt;

#[cfg(target_os = "ios")]
use super::fs::exclude_from_backup;

use crate::domain::{
    models::{Arch, NativeAppInfo, Target},
    ports::SystemQuery,
};

/// Queries the running Tauri app for version, architecture, and OS target.
pub struct SystemInfo<R: Runtime> {
    app_handle: tauri::AppHandle<R>,
    native_build: u64,
}

impl<R: Runtime> SystemInfo<R> {
    /// Create a new system info query bound to the given app handle.
    pub fn new(app_handle: tauri::AppHandle<R>, native_build: u64) -> Self {
        Self {
            app_handle,
            native_build,
        }
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

/// Return persistent storage for downloaded bundles and their markers.
///
/// iOS deliberately ignores the legacy cache contents. Startup falls back to
/// the embedded bundle and downloads the current bundle into Application
/// Support instead. Other platforms retain their existing cache location.
pub(crate) fn bundle_storage_dir<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, std::io::Error> {
    #[cfg(target_os = "ios")]
    let path = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("bundle-updates"));
    #[cfg(not(target_os = "ios"))]
    let path = app.path().app_cache_dir();

    let path = path.map_err(|error| std::io::Error::new(std::io::ErrorKind::NotFound, error))?;
    #[cfg(target_os = "ios")]
    {
        std::fs::create_dir_all(&path)?;
        exclude_from_backup(&path)?;
    }
    Ok(path)
}

impl<R: Runtime> SystemQuery for SystemInfo<R> {
    async fn get_native_app_info(&self) -> Result<NativeAppInfo, rootcause::Report> {
        Ok(NativeAppInfo {
            native_build: self.native_build,
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
        bundle_storage_dir(&self.app_handle)
    }
}

#[cfg(target_os = "ios")]
/// Return the current native app build number.
pub fn native_build() -> u64 {
    use objc2::rc::autoreleasepool;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;

    autoreleasepool(|_| unsafe {
        let bundle: *mut AnyObject = msg_send![class!(NSBundle), mainBundle];
        if bundle.is_null() {
            return 0;
        }
        let Ok(key) = CString::new("CFBundleVersion") else {
            return 0;
        };
        let key: *mut AnyObject = msg_send![
            class!(NSString),
            stringWithUTF8String: key.as_ptr() as *const c_char
        ];
        let value: *mut AnyObject = msg_send![bundle, objectForInfoDictionaryKey: key];
        if value.is_null() {
            return 0;
        }
        let c_value: *const c_char = msg_send![value, UTF8String];
        if c_value.is_null() {
            return 0;
        }
        CStr::from_ptr(c_value)
            .to_str()
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0)
    })
}

#[cfg(target_os = "android")]
/// Return the current native app build number.
pub fn native_build() -> u64 {
    use jni::JavaVM;
    use jni::objects::{JObject, JValue};
    use jni::sys::jint;

    let context = ndk_context::android_context();
    unsafe {
        let Ok(vm) = JavaVM::from_raw(context.vm().cast()) else {
            return 0;
        };
        let Ok(mut env) = vm.attach_current_thread() else {
            return 0;
        };
        let app_context = JObject::from_raw(context.context().cast());
        let Ok(package_manager) = env
            .call_method(
                &app_context,
                "getPackageManager",
                "()Landroid/content/pm/PackageManager;",
                &[],
            )
            .and_then(|value| value.l())
        else {
            return 0;
        };
        let Ok(package_name) = env
            .call_method(&app_context, "getPackageName", "()Ljava/lang/String;", &[])
            .and_then(|value| value.l())
        else {
            return 0;
        };
        let flags = JValue::Int(0 as jint);
        let Ok(package_info) = env
            .call_method(
                package_manager,
                "getPackageInfo",
                "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;",
                &[JValue::Object(&package_name), flags],
            )
            .and_then(|value| value.l())
        else {
            return 0;
        };
        if let Ok(value) = env
            .call_method(&package_info, "getLongVersionCode", "()J", &[])
            .and_then(|value| value.j())
        {
            return u64::try_from(value).unwrap_or(0);
        }
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }

        env.get_field(&package_info, "versionCode", "I")
            .and_then(|value| value.i())
            .map(|value| u64::try_from(value).unwrap_or(0))
            .unwrap_or(0)
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
/// Return the current native app build number.
pub fn native_build() -> u64 {
    0
}
