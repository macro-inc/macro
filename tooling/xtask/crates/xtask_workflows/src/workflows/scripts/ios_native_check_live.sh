set -euo pipefail
# The gate proper: the committed version + build must be live, built from the
# native code of the PR's current merge result.
merge=$(pr_merge_commit)
native_tree_fetch "$merge"
native_tree=$(native_tree_hash "$merge")
echo "Merge result ${merge:0:10}: native tree ${native_tree}"
bun scripts/ios-app-store.mjs status --require-live --native-tree "$native_tree"
