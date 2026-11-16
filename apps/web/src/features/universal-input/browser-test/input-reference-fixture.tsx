import { authKeys } from '@queries/auth/keys';
import { emailKeys } from '@queries/email/keys';
import type { QueryClient } from '@tanstack/solid-query';
import { onCleanup } from 'solid-js';
import { parseSearchFilters } from '../../next-soup/core/search-filters';
import { inputPeopleTerms } from '../core/people-terms';
import type { UniversalInputController } from '../primitives/universal-input';
import { useInputPeople } from '../queries/input-people';
import {
  pauseIdentityLookups,
  referencePages,
  registerContactFixture,
  resumeIdentityLookups,
} from './contact-directory-fixture';

export function referenceSearchFields(text: string) {
  return {
    query: 'reference content',
    searchFilters: parseSearchFilters(
      JSON.stringify({
        type: 'task',
        task: {
          status: [],
          priority: [],
          assignees: [text.replace(/^search\s+/i, '')],
          createdBy: [],
        },
      })
    ),
  };
}

export type InputPeople = ReturnType<typeof useInputPeople>;
export function seedInputReferences(client: QueryClient) {
  const viewer = 'macro|viewer@example.com';
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: viewer,
    email: 'viewer@example.com',
    authenticated: true,
  });
  client.setQueryData(emailKeys.links(viewer).queryKey, { links: [] });
  registerContactFixture([
    ...Array.from({ length: 60 }, (_, i) => ({
      id: `macro|person${i}@example.com`,
      email: `person${i}@example.com`,
      name: `Directory person ${String(i).padStart(3, '0')}`,
    })),
    {
      id: 'macro|late@example.com',
      email: 'late@example.com',
      name: 'Late Person',
    },
    {
      id: 'macro|one@example.com',
      email: 'one@example.com',
      name: 'Ambiguous One',
    },
    {
      id: 'macro|two@example.com',
      email: 'two@example.com',
      name: 'Ambiguous Two',
    },
    {
      id: 'macro|precise@example.com',
      email: 'precise@example.com',
      name: 'Precise',
    },
    {
      id: 'macro|other@example.com',
      email: 'other@example.com',
      name: 'Precise Person',
    },
    {
      id: 'macro|family-given@example.com',
      email: 'family-given@example.com',
      name: 'Family, Given',
    },
    {
      id: 'macro|family@example.com',
      email: 'family@example.com',
      name: 'Family',
    },
    {
      id: 'macro|given@example.com',
      email: 'given@example.com',
      name: 'Given',
    },
    {
      id: 'macro|alias@example.com',
      email: 'alias@example.com',
      name: 'target@example.com',
    },
  ]);
}

/** Real reference adapter/source under the actual composer providers. */
export function InputReferenceFixture(props: {
  state: UniversalInputController;
  onSource: (source: InputPeople | undefined) => void;
}) {
  const source = useInputPeople(
    props.state.fields,
    () => props.state.draft().intent,
    () => []
  );
  props.onSource(source);
  onCleanup(() => {
    props.onSource(undefined);
    resumeIdentityLookups();
  });
  const terms = () =>
    inputPeopleTerms(props.state.fields(), props.state.draft().intent);
  return (
    <>
      <button onClick={pauseIdentityLookups}>Pause identity lookups</button>
      <button onClick={resumeIdentityLookups}>Resume identity lookups</button>
      <output hidden data-testid="people-reference-terms">
        {JSON.stringify(terms())}
      </output>
      <output hidden data-testid="people-reference-status">
        {source.loading()
          ? 'loading'
          : source.error()
            ? 'error'
            : terms().every((term) => source.lookup(term) !== undefined)
              ? 'ready'
              : 'incomplete'}
      </output>
      <output hidden data-testid="people-reference-result">
        {JSON.stringify(terms().map((term) => source.lookup(term)))}
      </output>
      <output hidden data-testid="people-reference-pages">
        {referencePages()}
      </output>
    </>
  );
}
