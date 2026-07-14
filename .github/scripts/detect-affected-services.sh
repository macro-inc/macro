#!/bin/bash
set -e

# This script detects which services are affected by changes in the root Rust workspace.
# It uses cargo metadata to build a proper dependency graph

# Get changed files from git
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD | grep -E "^(Cargo\.(toml|lock)|rust-toolchain\.toml|Cross\.toml|clippy\.toml|deny\.toml|\.cargo/|\.config/|\.sqlx/|crates/|services/|tooling/xtask/|docker/|infra/|\.github/services-config\.json|\.github/workspace-dep-closures\.json|\.github/scripts/build-cloud-storage-lambdas(-nix)?\.sh)" || true)

if [ -z "$CHANGED_FILES" ]; then
    echo "No Rust service or deployment files changed"
    echo "services=[]"
    echo "has_changes=false"
    exit 0
fi

echo "Changed files:" >&2
echo "$CHANGED_FILES" >&2

# Get cargo metadata for the entire workspace with dependencies
METADATA=$(cargo metadata --format-version 1 --no-deps)
WORKSPACE_ROOT=$(echo "$METADATA" | jq -r '.workspace_root')

# Extract changed packages from the changed files
CHANGED_PACKAGES=()
while IFS= read -r file; do
    if [[ "$file" =~ ^(crates/[^/]+|services/[^/]+)/ ]]; then
        PKG_DIR="${BASH_REMATCH[1]}"
        PKG_NAME=$(echo "$METADATA" | jq -r \
          --arg manifest "$WORKSPACE_ROOT/$PKG_DIR/Cargo.toml" \
          '.packages[] | select(.manifest_path == $manifest) | .name' | head -n1)
        if [ -n "$PKG_NAME" ]; then
            # Avoid duplicates
            if [[ ! " ${CHANGED_PACKAGES[@]} " =~ " ${PKG_NAME} " ]]; then
                CHANGED_PACKAGES+=("$PKG_NAME")
                echo "Package $PKG_NAME has direct changes" >&2
            fi
        fi
    fi
done <<< "$CHANGED_FILES"

# Now find all services that are affected
AFFECTED_SERVICES=()

# Get services from the config file
SERVICES=$(jq -r '.services | keys[]' .github/services-config.json)

# Changes to shared build/deploy machinery can affect every deployable service.
GLOBAL_CHANGE=false
if echo "$CHANGED_FILES" | grep -qE '^(Cargo\.(toml|lock)|rust-toolchain\.toml|Cross\.toml|clippy\.toml|deny\.toml|\.cargo/|\.config/|\.sqlx/|tooling/xtask/|docker/|infra/[^/]+$|infra/packages/|\.github/services-config\.json|\.github/workspace-dep-closures\.json|\.github/scripts/build-cloud-storage-lambdas(-nix)?\.sh)'; then
    GLOBAL_CHANGE=true
fi

for service in $SERVICES; do
    SERVICE_AFFECTED=false
    
    # Get the source paths for this service from config
    SOURCE_PATHS=$(jq -r --arg svc "$service" '.services[$svc].source_paths[]? // empty' .github/services-config.json)
    
    # Check stack path changes
    STACK_PATH=$(jq -r --arg svc "$service" '.services[$svc].stack_path // empty' .github/services-config.json)

    if [ "$GLOBAL_CHANGE" = true ]; then
        SERVICE_AFFECTED=true
        echo "Service $service affected by shared workspace/deployment changes" >&2
    fi
    if [ -n "$STACK_PATH" ]; then
        STACK_PATH_PATTERN="${STACK_PATH%/**}"
        if echo "$CHANGED_FILES" | grep -q "^$STACK_PATH_PATTERN"; then
            SERVICE_AFFECTED=true
            echo "Service $service affected by stack changes" >&2
        fi
    fi
    
    # If no source paths, check if already affected by stack
    if [ -z "$SOURCE_PATHS" ]; then
        if [ "$SERVICE_AFFECTED" = true ]; then
            AFFECTED_SERVICES+=("$service")
        fi
        continue
    fi
    
    # Check if any source path has direct changes
    while IFS= read -r source_path; do
        if [ -n "$source_path" ]; then
            SOURCE_PATH_PATTERN="${source_path%/**}"
            if echo "$CHANGED_FILES" | grep -q "^$SOURCE_PATH_PATTERN"; then
                SERVICE_AFFECTED=true
                echo "Service $service has direct source changes in $source_path" >&2
                break
            fi
        fi
    done <<< "$SOURCE_PATHS"
    
    # Check if any of the service's packages depend on changed packages
    if [ "$SERVICE_AFFECTED" = false ] && [ ${#CHANGED_PACKAGES[@]} -gt 0 ]; then
        echo "Checking dependencies for service $service..." >&2
        
        # For each source path of the service, extract the package name and check its dependencies
        while IFS= read -r source_path; do
            if [ -n "$source_path" ]; then
                # Resolve the package from its manifest path instead of assuming
                # the directory name and Cargo package name are identical.
                SOURCE_PATH_CLEAN="${source_path%/**}"
                SOURCE_PKG_NAME=$(echo "$METADATA" | jq -r \
                  --arg manifest "$WORKSPACE_ROOT/$SOURCE_PATH_CLEAN/Cargo.toml" \
                  '.packages[] | select(.manifest_path == $manifest) | .name' | head -n1)
                if [ -z "$SOURCE_PKG_NAME" ]; then
                    continue
                fi
                echo "  Checking if $SOURCE_PKG_NAME depends on changed packages..." >&2
                
                # Get all dependencies of this package
                DEPS=$(echo "$METADATA" | jq -r --arg name "$SOURCE_PKG_NAME" '
                    .packages[] | 
                    select(.name == $name) | 
                    .dependencies[] | 
                    .name
                ' | sort -u)
                
                # Check if any changed package is in the dependencies
                for changed_pkg in "${CHANGED_PACKAGES[@]}"; do
                    if echo "$DEPS" | grep -q "^$changed_pkg$"; then
                        SERVICE_AFFECTED=true
                        echo "  ✓ Service $service (via $SOURCE_PKG_NAME) depends on changed package: $changed_pkg" >&2
                        break 2  # Break both loops
                    fi
                done
            fi
        done <<< "$SOURCE_PATHS"
    fi
    
    if [ "$SERVICE_AFFECTED" = true ]; then
        AFFECTED_SERVICES+=("$service")
    fi
done

# Output results
if [ ${#AFFECTED_SERVICES[@]} -gt 0 ]; then
    # Create JSON array
    SERVICES_JSON=$(printf '%s\n' "${AFFECTED_SERVICES[@]}" | jq -R . | jq -s . | jq -c .)
    echo "services=$SERVICES_JSON"
    echo "has_changes=true"
    echo "Affected services: ${AFFECTED_SERVICES[@]}" >&2
else
    echo "services=[]"
    echo "has_changes=false"
    echo "No services affected by changes" >&2
fi
