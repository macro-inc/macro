import { describe, expect, it } from 'vitest';
import { baseUtility, classifyToken } from './ui-audit';

describe('baseUtility', () => {
  it('strips a variant prefix', () => {
    expect(baseUtility('hover:bg-hover')).toBe('bg-hover');
    expect(baseUtility('data-checked:text-ink')).toBe('text-ink');
  });

  it('strips stacked variants', () => {
    expect(baseUtility('md:hover:px-3')).toBe('px-3');
  });

  it('ignores colons inside an arbitrary variant selector', () => {
    expect(baseUtility('[&:hover]:bg-x')).toBe('bg-x');
    expect(baseUtility("[&>svg:not([class*='size-'])]:size-3")).toBe('size-3');
  });

  it('keeps an arbitrary value intact', () => {
    expect(baseUtility('h-[min(900px,calc(100vh-32px))]')).toBe(
      'h-[min(900px,calc(100vh-32px))]'
    );
  });

  it('drops the important prefix', () => {
    expect(baseUtility('!p-0')).toBe('p-0');
  });
});

describe('classifyToken', () => {
  it.each([
    'bg-surface',
    'text-sm',
    'rounded-xs',
    'border-edge-muted',
    'shadow-menu',
    'px-2',
    'h-7',
    'size-full',
    'gap-2',
    'font-semibold',
    'opacity-50',
  ])('treats %s as a visual override', (token) => {
    expect(classifyToken(token)).toBe('override');
  });

  it.each([
    'flex',
    'absolute',
    'items-center',
    'justify-between',
    'w-full',
    'max-h-80',
    'min-w-0',
    'mt-2',
    '-ml-1',
    'z-10',
    'overflow-x-auto',
    'shrink-0',
    'truncate',
    'transition-colors',
    'pointer-events-none',
    'sr-only',
  ])('treats %s as layout', (token) => {
    expect(classifyToken(token)).toBe('layout');
  });

  // Width is parent-driven layout; height sets the control's own size. The two
  // must not collapse, or every `w-full` would read as a misfit.
  it('separates width from height', () => {
    expect(classifyToken('w-32')).toBe('layout');
    expect(classifyToken('h-32')).toBe('override');
    expect(classifyToken('max-h-32')).toBe('layout');
  });

  it('classifies through a variant prefix', () => {
    expect(classifyToken('hover:bg-hover')).toBe('override');
    expect(classifyToken('md:flex')).toBe('layout');
  });

  it('reports project CSS classes as unknown rather than guessing', () => {
    expect(classifyToken('split-panel-inactive')).toBe('unknown');
  });
});
