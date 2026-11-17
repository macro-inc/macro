/**
 * A group chat's name, short enough for one line. A group chat is a private
 * channel; one nobody named is called after everyone else in it, which can run
 * to a dozen names, so a list of more than three keeps the first two and
 * counts the rest. Shorter names, and names people chose, stay as they are.
 * The surfaces it feeds aren't translated yet; when they are, make this one
 * plural `t()` message rather than concatenating.
 */
export function groupChatName(name: string) {
  const people = name.split(', ');
  if (people.length <= 3) return name;
  return `${people[0]}, ${people[1]} and ${people.length - 2} others`;
}

/**
 * Whether a private channel goes by its people rather than a chosen name. The
 * client can't see whether a name was chosen, so a comma-separated list is
 * read as people: such a chat isn't a "#channel".
 */
export function isNamedForPeople(name: string) {
  return name.includes(', ');
}

/** How a list names a channel: a group chat's name is shortened. */
export function channelListName(channel: {
  name: string;
  channelType?: string;
}) {
  return channel.channelType === 'private'
    ? groupChatName(channel.name)
    : channel.name;
}
