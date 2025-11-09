import { describe, it, expect } from 'vitest';
import { deepEqual, getPathValue, setPathValue, isObject } from '../../src/core/utils';

describe('Utility Functions', () => {
  describe('isObject', () => {
    it('should return true for objects', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ a: 1 })).toBe(true);
      expect(isObject(new Object())).toBe(true);
    });
    
    it('should return false for non-objects', () => {
      expect(isObject(null)).toBe(false);
      expect(isObject(undefined)).toBe(false);
      expect(isObject(42)).toBe(false);
      expect(isObject('string')).toBe(false);
      expect(isObject(true)).toBe(false);
      expect(isObject([])).toBe(false);
      expect(isObject(new Date())).toBe(false);
      expect(isObject(() => {})).toBe(false);
    });
  });
  
  describe('deepEqual', () => {
    it('should return true for identical primitive values', () => {
      expect(deepEqual(42, 42)).toBe(true);
      expect(deepEqual('hello', 'hello')).toBe(true);
      expect(deepEqual(true, true)).toBe(true);
      expect(deepEqual(null, null)).toBe(true);
      expect(deepEqual(undefined, undefined)).toBe(true);
    });
    
    it('should return false for different primitive values', () => {
      expect(deepEqual(42, 43)).toBe(false);
      expect(deepEqual('hello', 'world')).toBe(false);
      expect(deepEqual(true, false)).toBe(false);
      expect(deepEqual(null, undefined)).toBe(false);
      expect(deepEqual(0, null)).toBe(false);
    });
    
    it('should return true for identical simple objects', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(deepEqual({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true); // Order doesn't matter
    });
    
    it('should return false for different simple objects', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
      expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });
    
    it('should return true for identical arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });
    
    it('should return false for different arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
      expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    });
    
    it('should handle nested objects and arrays', () => {
      expect(deepEqual(
        { a: 1, b: { c: 3, d: [4, 5] } },
        { a: 1, b: { c: 3, d: [4, 5] } }
      )).toBe(true);
      
      expect(deepEqual(
        { a: 1, b: { c: 3, d: [4, 5] } },
        { a: 1, b: { c: 3, d: [4, 6] } }
      )).toBe(false);
    });
  });
  
  describe('getPathValue', () => {
    const testObj = {
      a: 1,
      b: {
        c: 2,
        d: [3, 4, 5],
        e: {
          f: 6
        }
      }
    };
    
    it('should return the value at a simple path', () => {
      expect(getPathValue(testObj, ['a'])).toBe(1);
    });
    
    it('should return the value at a nested path', () => {
      expect(getPathValue(testObj, ['b', 'c'])).toBe(2);
      expect(getPathValue(testObj, ['b', 'e', 'f'])).toBe(6);
    });
    
    it('should return the value from an array', () => {
      expect(getPathValue(testObj, ['b', 'd', '1'])).toBe(4);
    });
    
    it('should return undefined for non-existent paths', () => {
      expect(getPathValue(testObj, ['x'])).toBeUndefined();
      expect(getPathValue(testObj, ['b', 'x'])).toBeUndefined();
      expect(getPathValue(testObj, ['b', 'd', '10'])).toBeUndefined();
    });
    
    it('should handle empty path', () => {
      expect(getPathValue(testObj, [])).toBe(testObj);
    });
  });
  
  describe('setPathValue', () => {
    it('should set a value at a simple path', () => {
      const obj = { a: 1 };
      setPathValue(obj, ['b'], 2);
      expect(obj).toEqual({ a: 1, b: 2 });
    });
    
    it('should update a value at an existing path', () => {
      const obj = { a: 1, b: 2 };
      setPathValue(obj, ['b'], 3);
      expect(obj).toEqual({ a: 1, b: 3 });
    });
    
    it('should set a value at a nested path', () => {
      const obj = { a: 1 };
      setPathValue(obj, ['b', 'c'], 2);
      expect(obj).toEqual({ a: 1, b: { c: 2 } });
    });
    
    it('should update a value at an existing nested path', () => {
      const obj = { a: 1, b: { c: 2 } };
      setPathValue(obj, ['b', 'c'], 3);
      expect(obj).toEqual({ a: 1, b: { c: 3 } });
    });
    
    it('should set a value in an array', () => {
      const obj = { a: [1, 2, 3] };
      setPathValue(obj, ['a', '1'], 4);
      expect(obj).toEqual({ a: [1, 4, 3] });
    });
    
    it('should handle creating intermediate objects', () => {
      const obj = {};
      setPathValue(obj, ['a', 'b', 'c'], 1);
      expect(obj).toEqual({ a: { b: { c: 1 } } });
    });
    
    it('should handle empty path by returning the original object', () => {
      const obj = { a: 1 };
      setPathValue(obj, [], { b: 2 });
      expect(obj).toEqual({ a: 1 });
    });
  });
}); 
