import { match } from 'ts-pattern';
import type { MacroClient } from '../../utils/client';
import { AgentSession } from '../agent-sessions/agent-session';
import { CalendarEvent } from '../calendar/event';
import { CallRecord } from '../calls/call-record';
import { Channel } from '../channels/channel';
import { Chat } from '../chats/chat';
import { Company } from '../crm/company';
import { Contact } from '../crm/contact';
import { CrmPipeline } from '../crm/pipeline';
import { Database } from '../databases/database';
import { Document } from '../documents/document';
import { EmailThread } from '../email/thread';
import { ForeignEntity } from '../foreign/foreign-entity';
import { Form } from '../forms/form';
import { Initiative } from '../initiatives/initiative';
import { Project } from '../projects/project';
import type { EntityReference } from '../reference';
import { Routine } from '../routines/routine';
import { Team } from '../teams/team';
import { User } from '../users/user';

/**
 * @internal A handle for an activity row's entity, or `undefined` for kinds
 * addressed by more than their own id (channel messages, database rows).
 */
export function activityEntity(
  client: MacroClient,
  type: string,
  id: string,
): EntityReference | undefined {
  return match<string, EntityReference | undefined>(type)
    .with('user', () => ({ type: 'user', entity: User.byId(client, id) }))
    .with('team', () => ({ type: 'team', entity: Team.byId(client, id) }))
    .with('document', () => ({
      type: 'document',
      entity: Document.byId(client, id),
    }))
    .with('chat', () => ({ type: 'chat', entity: Chat.byId(client, id) }))
    .with('channel', () => ({
      type: 'channel',
      entity: Channel.byId(client, id),
    }))
    .with('project', () => ({
      type: 'project',
      entity: Project.byId(client, id),
    }))
    .with('email_thread', () => ({
      type: 'email_thread',
      entity: EmailThread.byId(client, id),
    }))
    .with('calendar_event', () => ({
      type: 'calendar_event',
      entity: CalendarEvent.byId(client, id),
    }))
    .with('call', () => ({ type: 'call', entity: CallRecord.byId(client, id) }))
    .with('foreign_entity', () => ({
      type: 'foreign_entity',
      entity: ForeignEntity.byId(client, id),
    }))
    .with('crm_company', () => ({
      type: 'crm_company',
      entity: Company.byId(client, id),
    }))
    .with('crm_contact', () => ({
      type: 'crm_contact',
      entity: Contact.byId(client, id),
    }))
    .with('crm_pipeline', () => ({
      type: 'crm_pipeline',
      entity: CrmPipeline.byId(client, id),
    }))
    .with('agent_session', () => ({
      type: 'agent_session',
      entity: AgentSession.byId(client, id),
    }))
    .with('scheduled_action', () => ({
      type: 'scheduled_action',
      entity: Routine.byId(client, id),
    }))
    .with('initiative', () => ({
      type: 'initiative',
      entity: Initiative.byId(client, id),
    }))
    .with('database', () => ({
      type: 'database',
      entity: Database.byId(client, id),
    }))
    .with('form', () => ({ type: 'form', entity: Form.byId(client, id) }))
    .otherwise(() => undefined);
}
