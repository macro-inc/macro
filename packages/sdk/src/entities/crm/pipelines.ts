import type { CreatePipeline } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { CrmPipeline } from './pipeline';

/** CRM pipelines in the caller's team. */
export class PipelineNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy pipeline handle. */
  byId(id: string): CrmPipeline {
    return CrmPipeline.byId(this.client, id);
  }

  /** List accessible pipelines. */
  async list(): Promise<CrmPipeline[]> {
    return unwrap(await this.client.storage.listCrmPipelines()).map((p) =>
      CrmPipeline.from(this.client, p),
    );
  }

  /** Create a pipeline and its backing storage. */
  async create(options: CreatePipeline): Promise<CrmPipeline> {
    return CrmPipeline.from(
      this.client,
      unwrap(await this.client.storage.createCrmPipeline({ body: options })),
    );
  }
}
