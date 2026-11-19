undef $/; $_=<STDIN>;
s/(  const normalized = normalizeMessageSender\(message\);\n  const existing = getTargetMessage\(parent, target\);\n)/$1  console.log('DBGapply', change, message.content.slice(0, 24), existing ? 'existing' : 'new', message.created_at);\n/ or die 2;
print;
