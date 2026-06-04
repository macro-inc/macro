#!/usr/bin/env bash
set -euo pipefail

lambda_name="call_recording_preview_handler"
ffmpeg_version="7.0.2"
archive_name="ffmpeg-${ffmpeg_version}-amd64-static.tar.xz"
archive_dir="ffmpeg-${ffmpeg_version}-amd64-static"
archive_url="https://johnvansickle.com/ffmpeg/releases/${archive_name}"
archive_sha256="abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
crate_dir="$(cd "${script_dir}/.." && pwd)"
workspace_dir="$(cd "${crate_dir}/.." && pwd)"
zip_path="${workspace_dir}/target/lambda/${lambda_name}/bootstrap.zip"

if [[ ! -f "${zip_path}" ]]; then
  echo "Lambda zip not found: ${zip_path}" >&2
  echo "Run cargo lambda build before packaging ffmpeg." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

archive_path="${tmp_dir}/${archive_name}"
extract_dir="${tmp_dir}/extract"
package_dir="${tmp_dir}/package"

mkdir -p "${extract_dir}" "${package_dir}/bin"

echo "Downloading ${archive_url}"
curl --fail --location --show-error --retry 3 --output "${archive_path}" "${archive_url}"

echo "Verifying ${archive_name}"
printf '%s  %s\n' "${archive_sha256}" "${archive_path}" | sha256sum --check --status

tar -xJf "${archive_path}" -C "${extract_dir}" \
  "${archive_dir}/ffmpeg" \
  "${archive_dir}/ffprobe"

install -m 0755 "${extract_dir}/${archive_dir}/ffmpeg" "${package_dir}/bin/ffmpeg"
install -m 0755 "${extract_dir}/${archive_dir}/ffprobe" "${package_dir}/bin/ffprobe"

echo "Adding ffmpeg and ffprobe to ${zip_path}"
(
  cd "${package_dir}"
  zip -9 -q "${zip_path}" bin/ffmpeg bin/ffprobe
)

unzip -tqq "${zip_path}" >/dev/null

echo "Packaged ffmpeg ${ffmpeg_version} into ${zip_path}"
