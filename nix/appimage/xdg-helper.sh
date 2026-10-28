#!/usr/bin/env bash
set -e
helper=${0##*/}
case "$helper" in xdg-open|xdg-mime) ;; *) exit 2;; esac
if [[ ${MACRO_APPIMAGE_HOST_ENV_CAPTURED:-} == 1 && -n ${APPDIR:-} ]]; then
  support_dir="$APPDIR/usr/libexec/macro"
else
  script=$(realpath "$0")
  support_dir="${script%/*}/../libexec/macro"
fi
# Host gio/browsers must not load the AppImage's GLib or its plugin directories.
# shellcheck disable=SC1091
source "$support_dir/host-environment.sh"
macro_restore_host_environment
exec "$support_dir/$helper" "$@"
