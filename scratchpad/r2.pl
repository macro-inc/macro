undef $/; $_=<STDIN>;
s/  const position = \{\n    id: moved\.message\.id,\n    createdAt: moved\.message\.created_at,\n  \};\n/  const position = timelineEntryPosition(moved);\n/ or die 1;
s/  \/\/ Entries run newest first: the message goes above the first older message\.\n  const older = others\.findIndex\(\n    \(entry\) =>\n      entry\.type === 'message' &&\n      compareTimelinePositions\(\n        \{ id: entry\.message\.id, createdAt: entry\.message\.created_at \},\n        position\n      \) < 0\n  \);/  \/\/ Entries run newest first: the message goes above the first older entry.\n  const older = others.findIndex(\n    (entry) =>\n      compareTimelinePositions(timelineEntryPosition(entry), position) < 0\n  );/ or die 2;
s/(  timelineEntryKey,\n)(  timelineMessages,\n\} from '\.\/timeline-entries';)/$1  timelineEntryPosition,\n$2/ or die 4;
print;
