#!/usr/bin/env bash
# Variables modified by our hooks or the native AppRun, not general user settings.
macro_host_variables=(
  PATH LD_LIBRARY_PATH XDG_DATA_DIRS PERLLIB QT_PLUGIN_PATH PYTHONDONTWRITEBYTECODE
  GIO_EXTRA_MODULES GSETTINGS_SCHEMA_DIR XKB_CONFIG_ROOT SSL_CERT_FILE
  WEBKIT_INJECTED_BUNDLE_PATH GST_REGISTRY_REUSE_PLUGIN_SCANNER
  GST_PLUGIN_SYSTEM_PATH_1_0 GST_PLUGIN_PATH_1_0 GST_PLUGIN_SCANNER_1_0 GST_PTP_HELPER_1_0
)

macro_capture_host_environment() {
  [[ ${MACRO_APPIMAGE_HOST_ENV_CAPTURED:-} == 1 ]] && return 0
  local variable saved
  for variable in "${macro_host_variables[@]}"; do
    saved="MACRO_APPIMAGE_ORIGINAL_$variable"
    unset "$saved"
    if [[ -v $variable ]]; then
      printf -v "$saved" '%s' "${!variable}"
      export "${saved?}"
    fi
  done
  export MACRO_APPIMAGE_HOST_ENV_CAPTURED=1
}

macro_restore_host_environment() {
  [[ ${MACRO_APPIMAGE_HOST_ENV_CAPTURED:-} == 1 ]] || return 0
  local variable saved
  for variable in "${macro_host_variables[@]}"; do
    saved="MACRO_APPIMAGE_ORIGINAL_$variable"
    if [[ -v $saved ]]; then
      printf -v "$variable" '%s' "${!saved}"
      export "${variable?}"
    else
      unset "$variable"
    fi
    unset "$saved"
  done
  unset MACRO_APPIMAGE_HOST_ENV_CAPTURED APPDIR APPIMAGE APPIMAGE_SILENT_INSTALL APPIMAGE_DEBUG_EXEC _APPIMAGE_SCHEMA_DIR
}
