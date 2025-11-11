#!/bin/bash
set -e

# This script detects which services are affected by changes in the cloud-storage workspace
# It uses cargo metadata to build a proper dependency graph

# Get changed files from git
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD | grep "^rust/cloud-storage/" || true)

if [ -z "$CHANGED_FILES" ]; then
    echo "No cloud-storage files changed"
    echo "services=[]"
    echo "has_changes=false"
    exit 0
fi

echo "Changed files:" >&2
echo "$CHANGED_FILES" >&2

# Change to cloud-storage directory
cd rust/cloud-storage

# Get cargo metadata for the entire workspace with dependencies
METADATA=$(cargo metadata --format-version 1 --no-deps)

# Extract changed packages from the changed files
CHANGED_PACKAGES=()
while IFS= read -r file; do
    # Extract package directory from file path (e.g., cloud-storage/models_bulk_upload/src/lib.rs -> models_bulk_upload)
    if [[ "$file" =~ ^rust/cloud-storage/([^/]+)/ ]]; then
        PKG_NAME="${BASH_REMATCH[1]}"
        # Check if this is actually a package in our workspace
        if echo "$METADATA" | jq -r --arg name "$PKG_NAME" '.packages[] | select(.name == $name) | .name' | grep -q "$PKG_NAME"; then
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
SERVICES=$(jq -r '.services | keys[]' ../.github/services-config.json)

for service in $SERVICES; do
    SERVICE_AFFECTED=false
    
    # Get the source paths for this service from config
    SOURCE_PATHS=$(jq -r --arg svc "$service" '.services[$svc].source_paths[]? // empty' ../.github/services-config.json)
    
    # Check stack path changes
    STACK_PATH=$(jq -r --arg svc "$service" '.services[$svc].stack_path // empty' ../.github/services-config.json)
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
                # Extract package name from source path (remove /** suffix if present and get basename)
                SOURCE_PATH_CLEAN="${source_path%/**}"
                SOURCE_PKG_NAME=$(basename "$SOURCE_PATH_CLEAN")
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
