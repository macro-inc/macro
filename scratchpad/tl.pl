undef $/; $_=<STDIN>;
my $fn = <<'T';
/**
 * Moves a root message of the newest page to where its time puts it among the
 * page's messages. A message the server placed after it was first shown, such
 * as this person's own send delivered late, otherwise stays where it was
 * written, above messages the server holds before it.
 */
export function placeTopLevelMessageInMessageTimeline(
  data: MessageTimelineData | undefined,
  messageId: string
): MessageTimelineData | undefined {
  const newestPage = data?.pages[0];
  if (!data || !newestPage || newestPage.previous_cursor) return data;
  const from = newestPage.entries.findIndex(
    (entry) => entry.type === 'message' && entry.message.id === messageId
  );
  const moved = newestPage.entries[from];
  if (moved?.type !== 'message') return data;
  const position = { id: moved.message.id, createdAt: moved.message.created_at };
  const others = newestPage.entries.filter((_, index) => index !== from);
  // Entries run newest first: the message goes above the first older message.
  const older = others.findIndex(
    (entry) =>
      entry.type === 'message' &&
      compareTimelinePositions(
        { id: entry.message.id, createdAt: entry.message.created_at },
        position
      ) < 0
  );
  const to = older === -1 ? others.length : older;
  if (to === from) return data;
  return {
    ...data,
    pages: [
      {
        ...newestPage,
        entries: [...others.slice(0, to), moved, ...others.slice(to)],
      },
      ...data.pages.slice(1),
    ],
  };
}

T
s/(\/\*\* Place live activity within the loaded span; later pages bring the rest\. \*\/)/$fn$1/ or die 1;
print;
