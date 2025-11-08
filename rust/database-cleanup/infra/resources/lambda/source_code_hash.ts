import * as pulumi from '@pulumi/pulumi';

interface SourceCodeHashInputs {
  sourceCodeHash: pulumi.Input<string>;
  build: () => void;
}

interface SourceCodeHashProviderInputs {
  sourceCodeHash: string;
  build: () => void;
}

type SourceCodeHashProviderOutputs = { sourceCodeHash: string };

class SourceCodeHashProvider implements pulumi.dynamic.ResourceProvider {
  build: (() => void) | undefined;

  setBuild(build: () => void) {
    this.build = build;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
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

  // eslint-disable-next-line @typescript-eslint/require-await
  public async diff(
    _id: pulumi.ID,
    prevOutput: SourceCodeHashProviderOutputs,
    newInput: SourceCodeHashProviderInputs,
  ): Promise<pulumi.dynamic.DiffResult> {
    const changes: pulumi.dynamic.DiffResult = {
      changes: prevOutput.sourceCodeHash !== newInput.sourceCodeHash,
    };

    console.log(
      `
      SourceCodeHashProvider diff: prev:    ${prevOutput.sourceCodeHash}
      SourceCodeHashProvider diff: new:     ${newInput.sourceCodeHash}
      SourceCodeHashProvider diff: changes: ${changes.changes}
      `,
    );

    return changes;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async update(
    _id: pulumi.ID,
    _currentOutputs: SourceCodeHashProviderOutputs,
    newInputs: SourceCodeHashProviderInputs,
  ): Promise<pulumi.dynamic.UpdateResult> {
    // rebuild the lambda if the source code has changed
    // this requires CJS pulumi, native code function serialization will break ESM version
    this.build && this.build();

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
    opts?: pulumi.ComponentResourceOptions,
  ) {
    const sourceCodeHashProvider = new SourceCodeHashProvider();
    // Set the build method for the lambda
    sourceCodeHashProvider.setBuild(args.build);
    super(sourceCodeHashProvider, name, args, opts);
  }
}
