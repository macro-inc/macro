import { describe, expect, test } from 'bun:test';
import type {
  ListSkillsData,
  ReadSkillData,
} from '../../../generated/cognition/types.gen';
import type { MacroClient } from '../../utils/client';
import { Document } from './document';
import { DocumentNamespace } from './namespace';
import { SystemSkill } from './system-skill';

const DEPLOY = '0190b6a5-6a40-7c4e-8b1e-2f6d1f0a9c11';
const CATCH_ME_UP = '5b0c4b0e-1d1f-5c4e-9a6e-0f7d3b2a1c90';

describe('documents.skills', () => {
  test('searches by name and returns skill documents and built-in skills', async () => {
    const requests: ListSkillsData['query'][] = [];
    const client = {
      cognition: {
        listSkills: async ({ query }: Pick<ListSkillsData, 'query'>) => {
          requests.push(query);
          return {
            data: {
              skills: [
                {
                  id: DEPLOY,
                  name: 'Deploy checklist',
                  description: 'Use when deploying a service',
                  updatedAt: '2026-11-01T09:30:00Z',
                  builtIn: false,
                },
                { id: CATCH_ME_UP, name: 'Catch me up', builtIn: true },
              ],
            },
          };
        },
      },
    } as unknown as MacroClient;

    const found = await new DocumentNamespace(client).skills({
      query: 'deploy',
      matchType: 'exact',
    });

    expect(requests).toEqual([{ query: 'deploy', matchType: 'exact' }]);
    expect(found).toHaveLength(2);
    const [deploy, catchMeUp] = found;
    expect(deploy?.skill).toBeInstanceOf(Document);
    expect(deploy?.skill.id).toBe(DEPLOY);
    expect(deploy?.name).toBe('Deploy checklist');
    expect(deploy?.description).toBe('Use when deploying a service');
    expect(deploy?.updatedAt).toBe('2026-11-01T09:30:00Z');
    expect(catchMeUp?.skill).toBeInstanceOf(SystemSkill);
    expect(catchMeUp?.skill.toJSON()).toEqual({
      id: CATCH_ME_UP,
      name: 'Catch me up',
    });
    expect(catchMeUp?.description).toBeUndefined();
    expect(catchMeUp?.updatedAt).toBeUndefined();
  });

  test('lists every skill when no query is given', async () => {
    const requests: ListSkillsData['query'][] = [];
    const client = {
      cognition: {
        listSkills: async ({ query }: Pick<ListSkillsData, 'query'>) => {
          requests.push(query);
          return { data: { skills: [] } };
        },
      },
    } as unknown as MacroClient;

    expect(await new DocumentNamespace(client).skills()).toEqual([]);
    expect(requests).toEqual([{ query: undefined, matchType: undefined }]);
  });
});

describe('SystemSkill.content', () => {
  test('reads the built-in skill instructions by its id', async () => {
    const reads: ReadSkillData['path'][] = [];
    const client = {
      cognition: {
        listSkills: async () => ({
          data: {
            skills: [{ id: CATCH_ME_UP, name: 'Catch me up', builtIn: true }],
          },
        }),
        readSkill: async ({ path }: Pick<ReadSkillData, 'path'>) => {
          reads.push(path);
          return {
            data: {
              id: CATCH_ME_UP,
              name: 'Catch me up',
              content: 'Summarize what changed since I last looked.',
              builtIn: true,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const [listing] = await new DocumentNamespace(client).skills();
    if (!(listing?.skill instanceof SystemSkill))
      throw new Error('expected a built-in skill');

    expect(await listing.skill.content()).toBe(
      'Summarize what changed since I last looked.',
    );
    expect(reads).toEqual([{ id: CATCH_ME_UP }]);
  });
});
