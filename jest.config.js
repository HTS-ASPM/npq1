'use strict'

module.exports = {
  testEnvironment: 'node',
  verbose: true,
  notify: false,
  collectCoverage: true,
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75
    },
    'scripts/*': {
      branches: 60,
      functions: 90,
      lines: 80,
      statements: 80
    }
  },
  testMatch: ['**/__tests__/**/*.test.js'],
  testPathIgnorePatterns: ['/__tests__/__fixtures__/*']
}
