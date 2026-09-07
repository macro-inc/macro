/**
 * @vitest-environment jsdom
 */

import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { cleanup, render } from '@solidjs/testing-library';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { createCustomPropertyHandler } from './CreateCustomProperty';

function renderTool(
  tool: NamedTool<'CreateCustomProperty', 'call'>,
  response?: NamedTool<'CreateCustomProperty', 'response'>
) {
  return render(() => (
    <Dynamic
      component={
        createCustomPropertyHandler.render as Component<Record<string, unknown>>
      }
      tool={tool}
      response={response}
      chat_id="chat-1"
      message_id="message-1"
      part_index={0}
      isComplete={response != null}
      renderContext={{ isStreaming: false, grouped: false }}
    />
  ));
}

afterEach(cleanup);

describe('CreateCustomProperty renderer', () => {
  it('renders the name and type while the tool is running', () => {
    const { container } = renderTool({
      id: 'tool-1',
      name: 'CreateCustomProperty',
      data: {
        display_name: 'Department',
        data_type: 'select',
        scope: 'team',
        options: ['Engineering', 'Sales'],
        multi: false,
      },
    });

    expect(container.textContent).toContain('Create property');
    expect(container.textContent).toContain('Department');
    expect(container.textContent).toContain('select');
    expect(container.textContent).toContain('team');
  });

  it('renders created state with option count', () => {
    const { container } = renderTool(
      {
        id: 'tool-1',
        name: 'CreateCustomProperty',
        data: {
          display_name: 'Department',
          data_type: 'select',
          scope: 'team',
        },
      },
      {
        id: 'tool-1',
        name: 'CreateCustomProperty',
        data: {
          propertyDefinitionId: 'def-1',
          displayName: 'Department',
          dataType: 'select_string',
          isMultiSelect: false,
          scope: 'team',
          options: [
            { id: 'opt-1', displayOrder: 0, displayValue: 'Engineering' },
            { id: 'opt-2', displayOrder: 1, displayValue: 'Sales' },
          ],
          summary: 'Created the team select_string property "Department".',
        },
      }
    );

    expect(container.textContent).toContain('Created property');
    expect(container.textContent).toContain('Department');
    expect(container.textContent).toContain('2 options');
  });
});
