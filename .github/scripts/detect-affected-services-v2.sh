#!/usr/bin/env bash
set -e

# This script detects which cloud-storage services need to be deployed based on git changes.
# It uses `cargo tree --invert` to find all reverse dependents (direct and transitive) of changed crates.
#
# Outputs:
#   services=["service1", "service2", ...]  - JSON array of affected stack names
#   has_changes=true|false                   - Whether any services need deployment
#
# Note: This script requires bash 4+ for associative arrays (Ubuntu in GitHub Actions has this).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAPPING_FILE="$REPO_ROOT/.github/stack-crate-mapping.json"
CLOUD_STORAGE_DIR="$REPO_ROOT/rust/cloud-storage"

# Get changed files from git diff (comparing with previous commit)
# Use HEAD~1 for push events, or compare with base branch for PRs
if [ -n "$GITHUB_BASE_REF" ]; then
    # Pull request - compare with base branch
    CHANGED_FILES=$(git diff --name-only "origin/$GITHUB_BASE_REF"...HEAD || true)
else
    # Push event - compare with previous commit
    CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || true)
fi

if [ -z "$CHANGED_FILES" ]; then
    echo "No files changed" >&2
    echo "services=[]"
    echo "has_changes=false"
    exit 0
fi

echo "=== Changed files ===" >&2
echo "$CHANGED_FILES" >&2
echo "" >&2

# Separate cloud-storage changes from infra changes
CLOUD_STORAGE_CHANGES=$(echo "$CHANGED_FILES" | grep "^rust/cloud-storage/" || true)
INFRA_CHANGES=$(echo "$CHANGED_FILES" | grep "^infra/stacks/" || true)

# Track affected stacks using temp file for portability
AFFECTED_STACKS_FILE=$(mktemp)
trap "rm -f $AFFECTED_STACKS_FILE" EXIT

# ============================================================
# Part 1: Handle infra-only changes
# ============================================================
if [ -n "$INFRA_CHANGES" ]; then
    echo "=== Infra changes detected ===" >&2
    while IFS= read -r file; do
        # Extract stack name from path: infra/stacks/<stack-name>/...
        if [[ "$file" =~ ^infra/stacks/([^/]+)/ ]]; then
            STACK_NAME="${BASH_REMATCH[1]}"
            # Check if this stack exists in our mapping
            if jq -e --arg stack "$STACK_NAME" '.stacks[$stack]' "$MAPPING_FILE" > /dev/null 2>&1; then
                echo "$STACK_NAME" >> "$AFFECTED_STACKS_FILE"
                echo "  Stack '$STACK_NAME' affected by infra changes" >&2
            fi
        fi
    done <<< "$INFRA_CHANGES"
    echo "" >&2
fi

# ============================================================
# Part 2: Handle Rust code changes using cargo tree
# ============================================================
if [ -n "$CLOUD_STORAGE_CHANGES" ]; then
    echo "=== Cloud-storage code changes detected ===" >&2

    # Extract changed crate names from file paths
    CHANGED_CRATES_FILE=$(mktemp)
    trap "rm -f $AFFECTED_STACKS_FILE $CHANGED_CRATES_FILE" EXIT

    while IFS= read -r file; do
        # Extract crate directory from path: rust/cloud-storage/<crate>/...
        if [[ "$file" =~ ^rust/cloud-storage/([^/]+)/ ]]; then
            CRATE_DIR="${BASH_REMATCH[1]}"
            # Skip non-crate directories
            if [[ "$CRATE_DIR" == "integration_tests" ]] || [[ "$CRATE_DIR" == "target" ]]; then
                continue
            fi
            echo "$CRATE_DIR"
        fi
    done <<< "$CLOUD_STORAGE_CHANGES" | sort -u > "$CHANGED_CRATES_FILE"

    echo "  Changed crates:" >&2
    while read -r crate; do
        echo "    - $crate" >&2
    done < "$CHANGED_CRATES_FILE"
    echo "" >&2

    if [ -s "$CHANGED_CRATES_FILE" ]; then
        # Build the reverse dependency map: for each changed crate, find all dependents
        echo "=== Finding reverse dependents using cargo tree ===" >&2
        cd "$CLOUD_STORAGE_DIR"

        ALL_AFFECTED_CRATES_FILE=$(mktemp)
        trap "rm -f $AFFECTED_STACKS_FILE $CHANGED_CRATES_FILE $ALL_AFFECTED_CRATES_FILE" EXIT

        while read -r crate; do
            echo "  Analyzing dependents of '$crate'..." >&2

            # Use cargo tree --invert to find all crates that depend on this one
            # --prefix none: no indentation, easier to parse
            # -e normal: only normal dependencies (not dev/build)
            cargo tree -i "$crate" --prefix none -e normal 2>/dev/null | \
                grep -E '^\w' | \
                cut -d' ' -f1 >> "$ALL_AFFECTED_CRATES_FILE" || true

            # Also include the changed crate itself
            echo "$crate" >> "$ALL_AFFECTED_CRATES_FILE"
        done < "$CHANGED_CRATES_FILE"

        # Deduplicate
        sort -u "$ALL_AFFECTED_CRATES_FILE" -o "$ALL_AFFECTED_CRATES_FILE"

        echo "" >&2
        echo "=== All affected crates ($(wc -l < "$ALL_AFFECTED_CRATES_FILE" | tr -d ' ') total) ===" >&2
        while read -r crate; do
            echo "  $crate" >&2
        done < "$ALL_AFFECTED_CRATES_FILE"
        echo "" >&2

        # Map affected crates to stacks
        echo "=== Mapping crates to stacks ===" >&2

        # Read all stacks and their crates from the mapping file
        STACK_NAMES=$(jq -r '.stacks | keys[]' "$MAPPING_FILE")

        for stack in $STACK_NAMES; do
            # Get the crates for this stack
            STACK_CRATES=$(jq -r --arg s "$stack" '.stacks[$s].crates // [] | .[]' "$MAPPING_FILE")

            # Check if any of the stack's crates are affected
            for stack_crate in $STACK_CRATES; do
                if grep -q "^${stack_crate}$" "$ALL_AFFECTED_CRATES_FILE"; then
                    echo "$stack" >> "$AFFECTED_STACKS_FILE"
                    echo "  Stack '$stack' affected via crate '$stack_crate'" >&2
                    break
                fi
            done
        done

        cd "$REPO_ROOT"
    fi
fi

echo "" >&2

# ============================================================
# Output results
# ============================================================
# Deduplicate affected stacks
sort -u "$AFFECTED_STACKS_FILE" -o "$AFFECTED_STACKS_FILE"
AFFECTED_COUNT=$(wc -l < "$AFFECTED_STACKS_FILE" | tr -d ' ')

if [ "$AFFECTED_COUNT" -gt 0 ]; then
    # Create JSON array from affected stacks
    SERVICES_JSON=$(cat "$AFFECTED_STACKS_FILE" | jq -R . | jq -s . | jq -c .)
    echo "services=$SERVICES_JSON"
    echo "has_changes=true"
    echo "=== Summary: $AFFECTED_COUNT stacks affected ===" >&2
    while read -r stack; do
        echo "  - $stack" >&2
    done < "$AFFECTED_STACKS_FILE"
else
    echo "services=[]"
    echo "has_changes=false"
    echo "=== Summary: No stacks affected ===" >&2
fi
