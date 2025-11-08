import * as pulumi from '@pulumi/pulumi';

interface SourceCodeHashInputs {
  sourceCodeHash: pulumi.Input<string>;
}

interface SourceCodeHashProviderInputs {
  sourceCodeHash: string;
}

type SourceCodeHashProviderOutputs = { sourceCodeHash: string };

class SourceCodeHashProvider implements pulumi.dynamic.ResourceProvider {
  // eslint-disable-next-line @typescript-eslint/require-await
  public async create(
    args: SourceCodeHashProviderInputs
  ): Promise<pulumi.dynamic.CreateResult> {
    const outs: SourceCodeHashProviderOutputs = {
      sourceCodeHash: args.sourceCodeHash,
    };

    return {
      id: args.sourceCodeHash,
      outs,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async diff(
    _id: pulumi.ID,
    prevOutput: SourceCodeHashProviderOutputs,
    newInput: SourceCodeHashProviderInputs
  ): Promise<pulumi.dynamic.DiffResult> {
    const changes: pulumi.dynamic.DiffResult = {
      changes: prevOutput.sourceCodeHash !== newInput.sourceCodeHash,
    };

    console.log(
      `
      SourceCodeHashProvider diff: prev:    ${prevOutput.sourceCodeHash}
      SourceCodeHashProvider diff: new:     ${newInput.sourceCodeHash}
      SourceCodeHashProvider diff: changes: ${changes.changes ?? 'false'}
      `
    );

    return changes;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async update(
    _id: pulumi.ID,
    _currentOutputs: SourceCodeHashProviderOutputs,
    newInputs: SourceCodeHashProviderInputs
  ): Promise<pulumi.dynamic.UpdateResult> {
    const outs: SourceCodeHashProviderOutputs = {
      sourceCodeHash: newInputs.sourceCodeHash,
    };

    return {
      outs,
    };
  }
}

export class SourceCodeHash extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: SourceCodeHashInputs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    const sourceCodeHashProvider = new SourceCodeHashProvider();
    super(sourceCodeHashProvider, name, args, opts);
  }
}
