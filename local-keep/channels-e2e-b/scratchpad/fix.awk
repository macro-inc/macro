/^<<<<<<< HEAD/ {next}
/^=======$/ {skip=1; next}
/^>>>>>>> / {skip=0; next}
skip {next}
/and its proof is run on a build with$/ { sub(/, and its proof is run on a build with$/, "."); print; getline; next }
/^- A test that runs on both builds and reads messages needs a proof on each:/ { print "- A test that runs on both builds and reads messages can fail on one alone:"; getline; print; getline; print "  and a break of the other path leaves the test passing, so watch it fail"; print "  on each."; next }
/^- Add the id to `ledger\/inventory.tsv`, then prove the test can fail: break/ { print "- Add the id to `ledger/inventory.tsv`. Before trusting a new test, watch it"; print "  fail: break the product where the behaviour lives and run it."; getline; getline; next }
{print}
