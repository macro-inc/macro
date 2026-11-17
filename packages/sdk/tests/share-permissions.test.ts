import { describe, expect, test } from 'bun:test';
import { CalendarEvent } from '../src/entities/calendar/event';
import { CallRecord } from '../src/entities/calls/call-record';
import { Channel } from '../src/entities/channels/channel';
import { Chat } from '../src/entities/chats/chat';
import { Document } from '../src/entities/documents/document';
import { Project } from '../src/entities/projects/project';
import type { SharePermissionOptions } from '../src/entities/sharing/permissions';
import type { MacroClient } from '../src/utils/client';

const channelId = '0198a4cc-e138-7670-a308-a6b766602710';

/** A client whose sharing endpoints record their requests and succeed. */
function recordingClient() {
  const requests: { operation: string; options: unknown }[] = [];
  const record =
    (operation: string) =>
    async (options: unknown): Promise<{ data: unknown }> => {
      requests.push({ operation, options });
      return { data: {} };
    };
  const client = {
    storage: {
      editDocument: record('editDocument'),
      editProjectV2: record('editProjectV2'),
      editCallRecord: record('editCallRecord'),
      shareWithChannel: record('shareWithChannel'),
    },
    cognition: {
      patchChat: record('patchChat'),
    },
  } as unknown as MacroClient;
  return { client, requests };
}

describe('updateSharePermissions', () => {
  test('sends link, team and channel grants to each entity endpoint', async () => {
    const { client, requests } = recordingClient();
    const channel = Channel.byId(client, channelId);
    const options: SharePermissionOptions = {
      linkShareAccessLevel: 'view',
      teamShareAccessLevel: null,
      channelSharePermissions: [
        { channel, accessLevel: 'comment', operation: 'add' },
      ],
    };
    const sharePermission = {
      linkShareAccessLevel: 'view',
      teamShareAccessLevel: null,
      channelSharePermissions: [
        { channelId, accessLevel: 'comment', operation: 'add' },
      ],
    };

    await Document.byId(client, 'document-1').updateSharePermissions(options);
    await Project.byId(client, 'project-1').updateSharePermissions(options);
    await CallRecord.byId(client, 'call-1').updateSharePermissions(options);
    await Chat.byId(client, 'chat-1').updateSharePermissions(options);

    expect(requests).toEqual([
      {
        operation: 'editDocument',
        options: {
          path: { document_id: 'document-1' },
          body: { sharePermission },
        },
      },
      {
        operation: 'editProjectV2',
        options: { path: { id: 'project-1' }, body: { sharePermission } },
      },
      {
        operation: 'editCallRecord',
        options: { path: { call_id: 'call-1' }, body: { sharePermission } },
      },
      {
        operation: 'patchChat',
        options: { path: { chat_id: 'chat-1' }, body: { sharePermission } },
      },
    ]);
  });

  test('null channel grants clear them', async () => {
    const { client, requests } = recordingClient();

    await Document.byId(client, 'document-1').updateSharePermissions({
      channelSharePermissions: null,
    });

    expect(requests).toEqual([
      {
        operation: 'editDocument',
        options: {
          path: { document_id: 'document-1' },
          body: { sharePermission: { channelSharePermissions: null } },
        },
      },
    ]);
  });
});

describe('CalendarEvent.shareWithChannel', () => {
  test('grants the channel the event by its stored type', async () => {
    const { client, requests } = recordingClient();

    await CalendarEvent.byId(client, 'event-1').shareWithChannel(
      Channel.byId(client, channelId),
    );

    expect(requests).toEqual([
      {
        operation: 'shareWithChannel',
        options: {
          path: { channel_id: channelId },
          body: { entityType: 'calendar_event', entityId: 'event-1' },
        },
      },
    ]);
  });
});
