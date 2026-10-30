import type { InputSession } from '../context/input-session';
import { UniversalInputFixture } from './fixture';

/** Real composer/controller with the fixture's recording-only destination adapters. */
export function CommandUniversalInput(props: InputSession) {
  return <UniversalInputFixture embedded command={props} />;
}

export function MobileUniversalInput(props: InputSession) {
  return <UniversalInputFixture embedded command={props} />;
}
