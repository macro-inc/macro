/^<<<<<<< / {next}
/^=======$/ {skip=1; next}
/^>>>>>>> / {skip=0; next}
skip {next}
{print}
