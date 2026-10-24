import type { LinkedGroupInfo } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Team } from '../teams/team';
import { WhatsAppGroup } from './group';

/** An existing group joined by the current user's connected WhatsApp account. */
export class WhatsAppRemoteGroup extends MacroEntity<LinkedGroupInfo> {
  /** Reference a remote group by its verified JID. */
  static byId(client: MacroClient, id: string): WhatsAppRemoteGroup {
    return new WhatsAppRemoteGroup(client, id);
  }

  /** Seed a group handle from the current account's roster. */
  static from(
    client: MacroClient,
    record: LinkedGroupInfo,
  ): WhatsAppRemoteGroup {
    return new WhatsAppRemoteGroup(client, record.jid, record);
  }

  protected async fetch(): Promise<LinkedGroupInfo> {
    const groups = unwrap(await this.client.storage.linkedGroups());
    const group = groups.find((record) => record.jid === this.id);
    if (!group) throw new MacroNotFoundError('WhatsApp group is not available');
    return group;
  }

  /** Current remote group subject. */
  readonly name = this.field('name');

  /** When the session service last observed this metadata. */
  readonly observedAt = this.field('observedAt');

  /** Current remote roster; membership alone does not grant Macro history access. */
  readonly participants = this.field('participants');

  /** Whether disappearing messages prevent retention of group content. */
  readonly disappearing = this.field('disappearing');

  /** Whether only remote administrators can post. */
  readonly announce = this.field('announce');

  /** Whether this group is an unsupported community parent or announcement group. */
  readonly community = this.field('community');

  /** Adopted entity, when this remote group has been added to Macro. */
  readonly group = this.mappedField('group', (record) =>
    record ? WhatsAppGroup.byId(this.client, record.id) : undefined,
  );

  /** Adopt with a name; share through the normal entity sharing endpoints. */
  async adopt(
    options: { team?: Team; name?: string } = {},
  ): Promise<WhatsAppGroup> {
    const result = await this.mutate((client) =>
      client.storage.linkedAdopt({
        body: {
          group_jid: this.id,
          team_id: options.team?.id,
          name: options.name,
        },
      }),
    );
    return WhatsAppGroup.byId(this.client, result.group_id);
  }

  /** Reload the group's roster and adoption state. */
  async refresh(): Promise<this> {
    this.detail.clear();
    await this.detail.get();
    return this;
  }
}
