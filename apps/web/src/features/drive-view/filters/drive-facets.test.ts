import {
  compileFacets,
  NIL_UUID,
  type TagFacetContext,
  testFacets,
} from '@app/features/soup/filters';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { describe, expect, it } from 'vitest';
import { DRIVE_FACETS, type DriveFacetEntity } from './drive-facets';

const facetContext: TagFacetContext = {
  tagPropertyDefinitionByOptionId: new Map([['urgent', 'tag-definition']]),
};

function document(
  fileType: string,
  subType?: 'snippet' | 'skill' | 'task',
  ownerId = 'creator-1'
): DriveFacetEntity {
  return {
    id: `${fileType}-${subType ?? 'document'}`,
    name: 'Document',
    ownerId,
    type: 'document',
    fileType,
    subType: subType ? { type: subType } : null,
  };
}

function project(ownerId: string): DriveFacetEntity {
  return {
    id: `project-${ownerId}`,
    name: 'Project',
    ownerId,
    type: 'project',
  };
}

function tagged(...optionIds: string[]): DriveFacetEntity {
  return {
    ...document('md'),
    properties: [
      {
        id: 'assignment',
        definition: { id: 'tag-definition' },
        value: { type: 'SelectOption', value: optionIds },
      } as SoupProperty,
    ],
  };
}

describe('DRIVE_FACETS', () => {
  it('exposes the Drive filter groups and every menu type id', () => {
    expect(DRIVE_FACETS.map((facet) => facet.id)).toEqual([
      'type',
      'created-by',
      'tags',
    ]);

    const typeFacet = DRIVE_FACETS[0];
    if (typeof typeFacet.options === 'function') {
      throw new Error('Drive type options must be static');
    }
    expect(typeFacet.options.map((option) => option.id)).toEqual([
      'doc-markdown',
      'doc-canvas',
      'doc-spreadsheet',
      'file-code',
      'file-image',
      'file-pdf',
      'file-docx',
      'file-video',
      'doc-snippet',
      'doc-skill',
      'file-other',
    ]);
  });

  it('compiles and evaluates OR-ed document types', () => {
    const selection = { type: ['doc-markdown', 'file-pdf'] };
    const ast = compileFacets(selection, DRIVE_FACETS, facetContext);

    expect(ast.df).toBeDefined();
    expect(ast.ef).toEqual({ l: { ThreadId: NIL_UUID } });
    expect(
      testFacets(selection, DRIVE_FACETS, document('md'), facetContext)
    ).toBe(true);
    expect(
      testFacets(selection, DRIVE_FACETS, document('pdf'), facetContext)
    ).toBe(true);
    expect(
      testFacets(
        selection,
        DRIVE_FACETS,
        document('md', 'snippet'),
        facetContext
      )
    ).toBe(false);
  });

  it('evaluates association-backed and other file types', () => {
    const matches = (id: string, fileType: string) =>
      testFacets(
        { type: [id] },
        DRIVE_FACETS,
        document(fileType),
        facetContext
      );

    expect(matches('file-code', 'ts')).toBe(true);
    expect(matches('file-image', 'png')).toBe(true);
    expect(matches('file-video', 'mp4')).toBe(true);
    expect(matches('file-other', 'zip')).toBe(true);
    expect(matches('file-other', 'pdf')).toBe(false);
  });

  it('compiles creator ownership for supported targets and tests every entity', () => {
    const selection = { 'created-by': ['creator-1'] };
    const ast = compileFacets(selection, DRIVE_FACETS, facetContext);

    expect(ast.df).toEqual({ l: { o: 'creator-1' } });
    expect(ast.cf).toEqual({ l: { o: 'creator-1' } });
    expect(ast.pf).toEqual({ l: { o: 'creator-1' } });
    expect(
      testFacets(selection, DRIVE_FACETS, project('creator-1'), facetContext)
    ).toBe(true);
    expect(
      testFacets(selection, DRIVE_FACETS, project('creator-2'), facetContext)
    ).toBe(false);
  });

  it('uses the shared tag compiler and predicate', () => {
    const selection = { tags: ['urgent'] };
    const ast = compileFacets(selection, DRIVE_FACETS, facetContext);

    expect(ast.propf).toEqual({
      l: { pd: 'tag-definition', v: { so: 'urgent' } },
    });
    expect(
      testFacets(selection, DRIVE_FACETS, tagged('urgent'), facetContext)
    ).toBe(true);
    expect(
      testFacets(selection, DRIVE_FACETS, tagged('other'), facetContext)
    ).toBe(false);
  });
});
