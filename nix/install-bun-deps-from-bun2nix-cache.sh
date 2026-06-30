# shellcheck shell=bash
# Install js/node_modules from a bun2nix fetchBunDeps cache inside the Nix sandbox.
#
# Bun's cache is enough for package tarballs, but `bun install` still fetches npm
# package metadata and git tarballs while resolving this workspace. Serve package
# metadata from the bun2nix cache locally and install git dependencies from the
# materialized bun2nix package store after the normal install.

set -euo pipefail

: "${BUN_DEPS:?BUN_DEPS must point at bun2nix.fetchBunDeps output}"

export HOME="$TMPDIR/home"
export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
mkdir -p "$HOME" "$BUN_INSTALL_CACHE_DIR"
cp -r "$BUN_DEPS/share/bun-cache/." "$BUN_INSTALL_CACHE_DIR"
chmod -R u+w "$BUN_INSTALL_CACHE_DIR"

# bun2nix has already applied patchedDependencies while building the cache.
# Remove them before `bun install` so Bun uses the normal, pre-patched cache keys.
yq -o=json 'del(.patchedDependencies)' package.json > package.json.tmp && mv package.json.tmp package.json
yq -o=json 'del(.patchedDependencies)' bun.lock > bun.lock.tmp && mv bun.lock.tmp bun.lock

mapfile -t git_package_dirs < <(find -L "$BUN_DEPS/share/bun-packages" -maxdepth 1 -mindepth 1 -type d -name 'github:*' | sort)
if ((${#git_package_dirs[@]} > 0)); then
  git_package_names=$(for package_dir in "${git_package_dirs[@]}"; do jq -r '.name' "$package_dir/package.json"; done | jq -Rsc 'split("\n") | map(select(length > 0))')

  # Bun tries to fetch git tarballs during install even though bun2nix has
  # fetched them already. Temporarily remove those dependency edges and copy the
  # fetched packages into node_modules below.
  while IFS= read -r package_json; do
    jq --argjson gitPackageNames "$git_package_names" '
      def withoutGitPackages:
        if type == "object" then
          with_entries(select(.key as $key | ($gitPackageNames | index($key) | not)))
        else
          .
        end;
      (if has("dependencies") then .dependencies |= withoutGitPackages else . end)
      | (if has("devDependencies") then .devDependencies |= withoutGitPackages else . end)
      | (if has("peerDependencies") then .peerDependencies |= withoutGitPackages else . end)
      | (if has("optionalDependencies") then .optionalDependencies |= withoutGitPackages else . end)
    ' "$package_json" > "$package_json.tmp"
    mv "$package_json.tmp" "$package_json"
  done < <(find . -path './node_modules' -prune -o -name package.json -type f -print)
fi

registry_root="$TMPDIR/npm-registry"
registry_lists="$TMPDIR/npm-registry-lists"
mkdir -p "$registry_root" "$registry_lists"
while IFS= read -r package_json; do
  name=$(jq -r '.name // empty' "$package_json")
  version=$(jq -r '.version // empty' "$package_json")
  [ -n "$name" ] && [ -n "$version" ] || continue
  key="${name//\//%2f}"
  printf '%s\n' "$name" > "$registry_lists/$key.name"
  printf '%s\n' "$package_json" >> "$registry_lists/$key.paths"
done < <(find -L "$BUN_DEPS/share/bun-packages" -name package.json -type f)

for list in "$registry_lists"/*.paths; do
  [ -e "$list" ] || continue
  key="${list%.paths}"
  key="${key##*/}"
  name=$(cat "$registry_lists/$key.name")
  metadata=$(jq -s -c --arg name "$name" '
    {
      _id: $name,
      name: $name,
      "dist-tags": { latest: (sort_by(.version) | last | .version) },
      versions: (reduce .[] as $pkg ({};
        .[$pkg.version] = ($pkg + {
          dist: (($pkg.dist // {}) + {
            tarball: "https://registry.npmjs.org/\($name)/-/\(($name | split("/") | last))-\($pkg.version).tgz"
          })
        })
      ))
    }
  ' $(cat "$list"))
  mkdir -p "$registry_root/$(dirname "$name")"
  printf '%s\n' "$metadata" > "$registry_root/$name"
  printf '%s\n' "$metadata" > "$registry_root/$key"
done

darkhttpd "$registry_root" --addr 127.0.0.1 --port 54321 --no-listing --default-mimetype application/json > "$TMPDIR/npm-registry.log" 2>&1 &
registry_pid=$!
trap 'kill "$registry_pid" 2>/dev/null || true' EXIT
bun install --linker=hoisted --ignore-scripts --no-progress --registry http://127.0.0.1:54321

for package_dir in "${git_package_dirs[@]}"; do
  name=$(jq -r '.name' "$package_dir/package.json")
  dest="node_modules/$name"
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  if [ "$name" = "pdfjs-dist" ]; then
    # Rollup's CommonJS interop expects a real in-tree package here.
    cp -aL "$package_dir" "$dest"
  else
    cp -a "$package_dir" "$dest"
  fi
  chmod -R u+w "$dest"

  # The tauri plugin git package is itself a workspace with internal symlinks.
  # Dereference those package links so Vite/Rollup can traverse them normally.
  if [ -d "$dest/packages" ]; then
    for package in "$dest"/packages/*; do
      if [ -L "$package" ]; then
        target=$(readlink -f "$package")
        rm "$package"
        mkdir -p "$package"
        cp -aL "$target"/. "$package"/
      fi
    done
  fi
done

# @inkibra/tauri-plugins imports @tauri-apps/api but does not declare it in the
# git package. Reuse the version resolved by the top-level workspace.
tauri_api_pkg=$(find -L "$BUN_DEPS/share/bun-packages" -maxdepth 1 -mindepth 1 -type d -name '@tauri-apps/api@*' | sort -V | tail -n1 || true)
if [ -n "$tauri_api_pkg" ] && [ -d node_modules/@inkibra/tauri-plugins ]; then
  mkdir -p node_modules/@tauri-apps node_modules/@inkibra/tauri-plugins/node_modules/@tauri-apps
  rm -rf node_modules/@tauri-apps/api node_modules/@inkibra/tauri-plugins/node_modules/@tauri-apps/api
  ln -sfn "$tauri_api_pkg" node_modules/@tauri-apps/api
  ln -sfn "$tauri_api_pkg" node_modules/@inkibra/tauri-plugins/node_modules/@tauri-apps/api
fi
