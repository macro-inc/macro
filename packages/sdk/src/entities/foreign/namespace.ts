import type { MacroClient } from '../../utils/client';
import { ForeignEntity } from './foreign-entity';

export class ForeignEntityNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): ForeignEntity {
    return ForeignEntity.byId(this.client, id);
  }
}
