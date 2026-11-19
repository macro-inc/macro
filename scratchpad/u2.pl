undef $/; $_ = <STDIN>;
s#  // Capture, so this runs before the cache host fails its requests.\n##  or die "a";
s#    \{ capture: true \}\n  \);\n  addEventListener\('pageshow'#    { capture: true }\n  );\n  addEventListener('pageshow'# or die "b";
print;
