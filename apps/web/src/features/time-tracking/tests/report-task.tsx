import {
  type PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import type { SoupPropertyFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { ReportTask, TaskLabelParts } from '../components/time-key-label';

type StatusId =
  (typeof PROPERTY_OPTION_IDS.STATUS)[keyof typeof PROPERTY_OPTION_IDS.STATUS];
type PriorityId =
  (typeof PROPERTY_OPTION_IDS.PRIORITY)[keyof typeof PROPERTY_OPTION_IDS.PRIORITY];

function selectProperty(
  definitionId: string,
  displayName: string,
  optionId: string
): SoupPropertyFieldsFragment {
  return {
    id: `${definitionId}:${optionId}`,
    propertyDefinitionId: definitionId,
    displayName,
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    specificEntityType: null,
    isSystem: true,
    isMetadata: false,
    value: {
      __typename: 'GraphqlSelectOptionPropertyValue',
      optionIds: [optionId],
    },
  };
}

/** A task as the summary reads it; by default neither status nor priority is set. */
export function reportTask(
  id: string,
  name: string,
  options: {
    status?: StatusId;
    priority?: PriorityId;
    completed?: boolean;
  } = {}
): ReportTask {
  return {
    __typename: 'GraphqlSoupDocument',
    id,
    name,
    subType: {
      __typename: 'GraphqlTaskSubType',
      isCompleted: options.completed ?? false,
    },
    properties: [
      ...(options.status
        ? [selectProperty(SYSTEM_PROPERTY_IDS.STATUS, 'Status', options.status)]
        : []),
      ...(options.priority
        ? [
            selectProperty(
              SYSTEM_PROPERTY_IDS.PRIORITY,
              'Priority',
              options.priority
            ),
          ]
        : []),
    ],
  };
}

/** Stand-ins for the host's read-only priority, status and timer, naming their task. */
export const TEST_TASK_PARTS: TaskLabelParts = {
  Lead: (props) => <button type="button">Status of {props.task.id}</button>,
  Timer: (props) => <span>Timer on {props.taskId}</span>,
};
