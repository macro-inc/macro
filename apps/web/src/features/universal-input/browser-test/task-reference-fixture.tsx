import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { authKeys } from '@queries/auth/keys';
import { emailKeys } from '@queries/email/keys';
import { propertiesKeys } from '@queries/properties/keys';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import type { QueryClient } from '@tanstack/solid-query';
import { onCleanup } from 'solid-js';
import type { UniversalInputController } from '../primitives/universal-input';
import { createTaskFieldSource } from '../queries/task-field-source';
import { TaskFields } from '../task-fields';
import {
  referencePages,
  registerContactFixture,
} from './contact-directory-fixture';

export type TaskValues = ReturnType<typeof createTaskFieldSource>['values'];
const VIEWER = 'macro|viewer@example.com';

export function seedTaskReferences(client: QueryClient) {
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: VIEWER,
    email: 'viewer@example.com',
    authenticated: true,
  });
  client.setQueryData(emailKeys.links(VIEWER).queryKey, { links: [] });
  client.setQueryData<PropertyDefinitionWithOptions[]>(
    propertiesKeys.definitions({ scope: 'system', includeOptions: true })
      .queryKey,
    [
      {
        definition: {
          id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
          display_name: 'Assignees',
          data_type: 'ENTITY',
          is_multi_select: true,
          specific_entity_type: 'USER',
          is_metadata: false,
          is_system: true,
          owner: { scope: 'system' },
          created_at: '',
          updated_at: '',
        },
        property_options: [],
      },
    ]
  );
  registerContactFixture([
    {
      id: 'macro|person99999@example.com',
      name: 'Off Window',
      email: 'person99999@example.com',
    },
    { id: 'macro|one@example.com', name: 'Shared', email: 'one@example.com' },
    {
      id: 'macro|two@example.com',
      name: 'Shared Person',
      email: 'two@example.com',
    },
  ]);
}

/** Real task inference, reference reader and property UI over isolated services. */
export function TaskReferenceFixture(props: {
  state: UniversalInputController;
  onValues: (values: TaskValues | undefined) => void;
}) {
  const source = createTaskFieldSource(
    VIEWER,
    props.state.fields,
    () => props.state.draft().intent === 'task'
  );
  props.onValues(source.values);
  onCleanup(() => props.onValues(undefined));
  return (
    <>
      <TaskFields
        values={source.values(props.state.fields()).values}
        value={props.state.fields().taskProperties}
        onChange={(value) => props.state.edit('taskProperties', value)}
      />
      <button
        onClick={() =>
          props.state.edit(
            'taskProperties',
            JSON.stringify({
              [SYSTEM_PROPERTY_IDS.ASSIGNEES]: {
                valueType: 'ENTITY',
                refs: [],
              },
            })
          )
        }
      >
        Clear inferred assignees
      </button>
      <output hidden data-testid="task-reference-input">
        {props.state.fields().properties}
      </output>
      <output hidden data-testid="task-reference-values">
        {JSON.stringify(source.values(props.state.fields()))}
      </output>
      <output hidden data-testid="task-reference-pages">
        {referencePages()}
      </output>
    </>
  );
}
