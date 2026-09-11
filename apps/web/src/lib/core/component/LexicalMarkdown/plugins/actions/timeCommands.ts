import type { DateDisplayMode } from '@macro-inc/lexical-core';

export const TIME_SLASH_COMMANDS = [
  'countdown',
  'duration',
  'date',
] as const satisfies readonly DateDisplayMode[];

export type TimeSlashCommand = (typeof TIME_SLASH_COMMANDS)[number];

export type ParsedTimeSlashCommand = {
  command: TimeSlashCommand;
  query: string;
};

export function parseTimeSlashCommand(
  search: string
): ParsedTimeSlashCommand | null {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return null;

  for (const command of TIME_SLASH_COMMANDS) {
    if (trimmed === command) {
      return { command, query: '' };
    }
    if (trimmed.startsWith(`${command} `)) {
      return {
        command,
        query: search.trim().slice(command.length).trim(),
      };
    }
  }

  return null;
}
