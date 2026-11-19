undef $/; $_ = <STDIN>;
s#      pageLeaving = true;#      pageLeaving = true;\n      localStorage.setItem('DBG13:' + Date.now() + ':flagset', 'x');# or die "a";
s#    pageLeaving = false;\n#    pageLeaving = false;\n    localStorage.setItem('DBG13:' + Date.now() + ':flagreset', 'x');\n# or die "b";
s#  watchPageLeaving\(\);#  watchPageLeaving();\n  localStorage.setItem('DBG13:' + Date.now() + ':watching', 'x');# or die "c";
print;
