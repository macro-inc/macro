const { defaults: tsjPreset } = require('ts-jest/presets');

module.exports = {
  roots: ['<rootDir>/__tests__'],
  transform: tsjPreset.transform,
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/setup.tests.js'],
  coveragePathIgnorePatterns: ['./route/*'],
  collectCoverageFrom: ['**/src/**/*.ts'],
  verbose: false,
};
