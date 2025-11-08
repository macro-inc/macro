import * as pulumi from '@pulumi/pulumi';

interface SourceCodeHashInputs {
  sourceCodeHash: pulumi.Input<string>;
}

interface SourceCodeHashProviderInputs {
  sourceCodeHash: string;
}

interface SourceCodeHashProviderOutputs extends SourceCodeHashProviderInputs {}

class SourceCodeHashProvider implements pulumi.dynamic.ResourceProvider {
  private buildFn: () => void;

  constructor(buildFn: () => void) {
    this.buildFn = buildFn;
  }

  public async create(
    args: SourceCodeHashProviderInputs,
  ): Promise<pulumi.dynamic.CreateResult> {
    const outs: SourceCodeHashProviderOutputs = {
      sourceCodeHash: args.sourceCodeHash,
    };

    return {
      id: args.sourceCodeHash,
      outs,
    };
  }

  public async diff(
    id: pulumi.ID,
    prevOutput: SourceCodeHashProviderOutputs,
    newInput: SourceCodeHashProviderInputs,
  ): Promise<pulumi.dynamic.DiffResult> {
    const changes: pulumi.dynamic.DiffResult = {
      changes: prevOutput.sourceCodeHash !== newInput.sourceCodeHash,
    };

    return changes;
  }

  public async update(
    id: pulumi.ID,
    currentOutputs: SourceCodeHashProviderOutputs,
    newInputs: SourceCodeHashProviderInputs,
  ): Promise<pulumi.dynamic.UpdateResult> {
    // rebuild if the source code has changed
    // this requires CJS pulumi, native code function serialization will break ESM version
    this.buildFn();

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
    buildFn: () => void,
    args: SourceCodeHashInputs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super(new SourceCodeHashProvider(buildFn), name, args, opts);
  }
}
