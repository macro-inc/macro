# --- authenticated fetch ------------------------------------------------------
# gh_fetch <sha|ref>: make a commit that is not in this checkout (the base
# commit, a moved PR head, GitHub's test merge commit) available. Checkouts
# here don't persist credentials, so authenticate the way actions/checkout
# does. Fails if the commit is unreachable (a force-pushed-away head).
gh_fetch() {
  local auth
  auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')
  git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}" \
    fetch -q --depth=1 origin "$1"
}
# ------------------------------------------------------------------------------
