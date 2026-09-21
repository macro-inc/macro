import { describe, expect, it } from 'vitest';
import { toolTitle } from './tool-name';

describe('toolTitle', () => {
  it('turns a snake_case name into words, with its acronyms in capitals', () => {
    expect(toolTitle('get_mcp_tools')).toEqual({
      title: 'Read MCP tools',
      activeTitle: 'Reading MCP tools',
    });
  });

  it('reads a camelCase name the same way', () => {
    expect(toolTitle('ReadContent')).toEqual({
      title: 'Read content',
      activeTitle: 'Reading content',
    });
    expect(toolTitle('SendChannelMessage')).toEqual({
      title: 'Sent channel message',
      activeTitle: 'Sending channel message',
    });
  });

  it('leaves a name that does not start with a verb in the present', () => {
    expect(toolTitle('BashCodeExecution')).toEqual({
      title: 'Bash code execution',
      activeTitle: undefined,
    });
  });

  it('keeps a one-word tool a word', () => {
    expect(toolTitle('deploy')).toEqual({
      title: 'Deploy',
      activeTitle: undefined,
    });
    expect(toolTitle('ask')).toEqual({
      title: 'Asked',
      activeTitle: 'Asking',
    });
  });

  it('capitalizes an acronym a name leads with', () => {
    expect(toolTitle('ui_audit')).toEqual({
      title: 'UI audit',
      activeTitle: undefined,
    });
  });

  it('splits a dotted or kebab name, and an acronym run in a camel one', () => {
    expect(toolTitle('deepwiki.ask-question')).toEqual({
      title: 'Deepwiki ask question',
      activeTitle: undefined,
    });
    expect(toolTitle('listMCPServers')).toEqual({
      title: 'Listed MCP servers',
      activeTitle: 'Listing MCP servers',
    });
  });
});
