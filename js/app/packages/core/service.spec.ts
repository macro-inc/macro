import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { Svc, withFetchErrors } from './service';

describe('Svc', () => {
  test('create a new service with description', () => {
    const svc = new Svc('Test Service');
    expect(svc.state.def.description).toBe('Test Service');
  });

  test('create a new service with additional options', () => {
    const svc = new Svc('Test Service', {
      modifies: true,
      access: { only: ['user'] },
    });
    expect(svc.state.def).toEqual({
      description: 'Test Service',
      modifies: true,
      access: { only: ['user'] },
    });
  });

  describe('err', () => {
    test('register an error code', () => {
      const svc = new Svc('Test Service').err('NOT_FOUND', {
        description: 'Resource not found',
      });
      expect(svc.state.errors['NOT_FOUND']).toEqual({
        code: 'NOT_FOUND',
        description: 'Resource not found',
      });
    });

    test('register a fatal error', () => {
      const svc = new Svc('Test Service').err('FATAL_ERROR', {
        description: 'A fatal error',
        fatal: true,
      });
      expect(svc.state.errors['FATAL_ERROR']).toEqual({
        code: 'FATAL_ERROR',
        description: 'A fatal error',
        fatal: true,
      });
    });
  });

  describe('fn', () => {
    test('add a function to the service', () => {
      const svc = new Svc('Test Service').fn('testFunction', {
        description: 'Test function',
        args: { input: z.string() },
        result: { output: z.number() },
      });
      const fn = svc.state.functions['testFunction'];
      expect(fn).toBeDefined();
      expect(fn.description).toBe('Test function');
      expect(fn.args).toBeDefined();
      expect(fn.result).toBeDefined();
    });

    test('inherit modifies and access from service options', () => {
      const svc = new Svc('Test Service', {
        modifies: true,
        access: { only: ['user'] },
      }).fn('testFunction', {
        description: 'Test function',
      });
      const fn = svc.state.functions['testFunction'];
      expect(fn.modifies).toBe(true);
      expect(fn.access).toEqual({ only: ['user'] });
    });
  });

  describe('use', () => {
    test('attach an existing service', () => {
      const childSvc = new Svc('Child Service');
      const parentSvc = new Svc('Parent Service').use('child', childSvc);
      expect(parentSvc.state.services['child']).toBe(childSvc);
    });
  });

  test('create a service with multiple functions, errors, and nested services', () => {
    const userService = new Svc('User Service')
      .err('USER_NOT_FOUND', { description: 'User not found' })
      .fn('getUser', {
        description: 'Get user by ID',
        args: { id: z.number() },
        result: { name: z.string(), email: z.string() },
        throws: ['USER_NOT_FOUND'],
      })
      .fn('createUser', {
        description: 'Create a new user',
        args: { name: z.string(), email: z.string() },
        result: { id: z.number() },
        modifies: true,
      });

    const postService = new Svc('Post Service')
      .err('POST_NOT_FOUND', { description: 'Post not found' })
      .fn('getPost', {
        description: 'Get post by ID',
        args: { id: z.number() },
        result: { title: z.string(), content: z.string() },
        throws: ['POST_NOT_FOUND'],
      });

    const mainService = new Svc('Main Service')
      .use('users', userService)
      .use('posts', postService);

    expect(mainService.state.services['users']).toBe(userService);
    expect(mainService.state.services['posts']).toBe(postService);
    expect(userService.state.errors['USER_NOT_FOUND']).toBeDefined();
    expect(postService.state.errors['POST_NOT_FOUND']).toBeDefined();
    expect(userService.state.functions['getUser']).toBeDefined();
    expect(userService.state.functions['createUser']).toBeDefined();
    expect(postService.state.functions['getPost']).toBeDefined();
  });
});

describe('withFetchErrors', () => {
  test('combine specific errors with fetch errors', () => {
    const specificErrors = ['CUSTOM_ERROR_1', 'CUSTOM_ERROR_2'] as const;
    const combinedErrors = withFetchErrors(...specificErrors);
    expect(combinedErrors).toContain('CUSTOM_ERROR_1');
    expect(combinedErrors).toContain('CUSTOM_ERROR_2');
    expect(combinedErrors).toContain('NETWORK_ERROR');
    expect(combinedErrors).toContain('HTTP_ERROR');
  });

  test('return only fetch errors when no specific errors are provided', () => {
    const combinedErrors = withFetchErrors();
    expect(combinedErrors).not.toContain('CUSTOM_ERROR');
    expect(combinedErrors).toContain('NETWORK_ERROR');
    expect(combinedErrors).toContain('HTTP_ERROR');
  });
});
