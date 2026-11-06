/** Character-by-character human input, scheduled by the scene's existing clock. */
export function demoTypingActions(
  text: string,
  write: (value: string) => void,
  lead = 80
) {
  const characters = Array.from(text);
  return characters.map((_, index) => ({
    delay:
      index === 0
        ? lead
        : /[.!?]/.test(characters[index - 1])
          ? 230
          : /[,;:]/.test(characters[index - 1])
            ? 150
            : characters[index - 1] === ' '
              ? 95
              : 42 + ((index * 7) % 5) * 9,
    run: () => write(characters.slice(0, index + 1).join('')),
  }));
}
