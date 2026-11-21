import type { Accessor } from 'solid-js';
import type { Size } from '../../core/geometry';
import type { ScreenInputController } from '../../primitives/screen-input';
import type { ScreenSessionController } from '../../primitives/screen-session';

/** Everything the desktop and phone views render from, built once by the route. */
export type AgentScreenModel = {
  harnessId: string;
  agentName: Accessor<string>;
  /** Manage on the computer: may take over. */
  canDrive: Accessor<boolean>;
  session: ScreenSessionController;
  input: ScreenInputController;
  setContainerSize: (size: Size) => void;
  /** The driver's display name, while someone drives. */
  driverName: Accessor<string | undefined>;
  /**
   * Connect again (Try again, View screen again). After access was revoked,
   * first refreshes what this person may do, so a demoted driver comes back
   * with a view ticket rather than be refused a drive one.
   */
  retry: () => void;
  /** Turns the computer on; present only for those who may. */
  turnOn: Accessor<(() => void) | undefined>;
};
