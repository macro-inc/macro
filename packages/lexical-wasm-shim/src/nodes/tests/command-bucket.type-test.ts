import type { CommandBucket, CommandRegistry } from '../../command/types';
import { createCommand } from '../../commands';
import { commandBucket } from '../../compatibility-exceptions';

declare const registry: CommandRegistry;
const numeric = createCommand<number>();
const textual = createCommand<string>();
export const numericBucket: CommandBucket<number> = commandBucket(
  registry,
  numeric
);
export const textualBucket: CommandBucket<string> = commandBucket(
  registry,
  textual
);
numericBucket[0].addBack((value) => value > 0);
textualBucket[0].addBack((value) => value.length > 0);
