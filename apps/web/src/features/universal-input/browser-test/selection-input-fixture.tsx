import type { InputSession } from '../context/input-session';
import { UniversalInputFixture } from './fixture';

/** Real composer and controller with the fixture's recording-only destinations. */
export function SelectionUniversalInput(props: InputSession) {
  return <UniversalInputFixture embedded command={props} />;
}
