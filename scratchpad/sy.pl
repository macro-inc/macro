undef $/; $_=<STDIN>;
s/( \* answer predates it, so the reactions on screen stay\.\n)( \*\/\nexport function applyQueuedWrite)/$1 * A delivered root message also moves to where the server placed it: messages\n * pushed while it waited were put below it, though the server holds them first.\n$2/ or die 1;
s/(  applyMessage\(\n    shown \? \{ \.\.\.message, reactions: shown\.reactions \} : message,\n    change\n  \);\n)/$1  if (change === 'posted' && !message.thread_id) {\n    setMessageTimelineData(message.parent, (data) =>\n      placeTopLevelMessageInMessageTimeline(data, message.id)\n    );\n  }\n/ or die 2;
print;
