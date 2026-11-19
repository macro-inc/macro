undef $/; $_ = <STDIN>;
s#    'pagehide',\n    \(\) => \{\n      pageLeaving = true;\n    \},#    'pagehide',\n    (event) => {\n      // A page kept for back and forward comes back as itself, and nothing\n      // would resend for it.\n      pageLeaving = !event.persisted;\n    },# or die "a";
print;
