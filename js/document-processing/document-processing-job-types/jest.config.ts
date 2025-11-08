import type { JestConfigWithTsJest } from 'ts-jest';
import { defaults as tsjPreset } from 'ts-jest/presets';

const config: JestConfigWithTsJest = {
  roots: ['<rootDir>/__tests__'],
  transform: { ...tsjPreset.transform },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/setup.tests.js'],
  coveragePathIgnorePatterns: [],
  collectCoverageFrom: ['**/src/**/*.ts'],
  verbose: false,
};

export default config;
