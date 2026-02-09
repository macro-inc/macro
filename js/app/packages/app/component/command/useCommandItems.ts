import { useQuickAccessWithCommands } from '@core/context/quickAccess';
import { createMemo } from 'solid-js';
import type { CommandItemCard } from './KonsoleItem';

/**
 * Hook that provides all items for the Konsole command palette.
 * Now uses the unified QuickAccess context internally.
 */
export function useCommandItems() {
  const quickAccess = useQuickAccessWithCommands({
    includeUnkeyed: false,
    hideShadowed: false,
    limitToCurrentScope: false,
  });

  // Get all items from quickAccess
  const allItems = quickAccess.useList();

  return createMemo<Map<string, CommandItemCard>>(() => {
    const items = allItems();
    const result = new Map<string, CommandItemCard>();

    for (const item of items) {
      let card: CommandItemCard;

      switch (item.kind) {
        case 'command': {
          const description =
            typeof item.data.description === 'function'
              ? item.data.description()
              : item.data.description;
          card = {
            type: 'command',
            data: {
              id: description.replaceAll(' ', '-'),
              name: description,
              command: item.data,
            },
            updatedAt: 0,
          };
          break;
        }

        case 'user': {
          // Users are not currently shown in Konsole, skip them
          continue;
        }

        case 'entity': {
          const entity = item.data;

          switch (entity.type) {
            case 'channel': {
              card = {
                type: 'channel',
                data: {
                  id: entity.id,
                  name: entity.name,
                  channel_type: entity.channelType,
                  participants: undefined, // Hydrated later by hydrateChannel
                },
                updatedAt: entity.updatedAt,
                viewedAt: entity.viewedAt,
              };
              break;
            }

            case 'document': {
              // Match original format - includes nested data for full item access
              card = {
                type: 'item',
                data: {
                  id: entity.id,
                  name: entity.name,
                  itemType: 'document',
                  fileType: entity.fileType,
                  subType: entity.subType,
                } as any,
                updatedAt: entity.updatedAt,
                viewedAt: entity.viewedAt,
              };
              break;
            }

            case 'chat': {
              card = {
                type: 'item',
                data: {
                  id: entity.id,
                  name: entity.name,
                  itemType: 'chat',
                } as any,
                updatedAt: entity.updatedAt,
                viewedAt: entity.viewedAt,
              };
              break;
            }

            case 'project': {
              card = {
                type: 'item',
                data: {
                  id: entity.id,
                  name: entity.name,
                  itemType: 'project',
                } as any,
                updatedAt: entity.updatedAt,
                viewedAt: entity.viewedAt,
              };
              break;
            }

            case 'email': {
              card = {
                type: 'email',
                data: {
                  id: entity.id,
                  name: entity.name ?? 'No Subject',
                  sender: entity.senderEmail ?? '',
                  timestamp: String(entity.updatedAt ?? ''),
                  is_read: entity.isRead ?? false,
                  attachments: [],
                },
                updatedAt: entity.updatedAt,
                viewedAt: entity.viewedAt,
              };
              break;
            }

            default:
              continue;
          }
          break;
        }

        default:
          continue;
      }

      result.set(card.data.id, card);
    }

    return result;
  });
}
