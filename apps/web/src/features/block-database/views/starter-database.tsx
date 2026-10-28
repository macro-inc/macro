import { useStarterDatabase } from '../queries/starter-database';

/** Background onboarding uses the same flag and query state as database navigation. */
export function StarterDatabase() {
  useStarterDatabase();
  return null;
}
