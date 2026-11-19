undef $/; $_=<STDIN>;
s/(      description: String\(error\)\.split\('\\n'\)\[0\],\n    \}\);\n)/$1    throw error;\n/ or die "x";
print;
