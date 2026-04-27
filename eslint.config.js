import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist',
      'playwright.config.js',
      'playwright-report',
      'test-results',
      'jest.config.js',
      '**/__tests__/**',
      '**/*.test.js',
      '**/*.md',
      '**/*.html',
      '**/*.json',
      '**/*.css',
      '**/*.sh',
      '.gitignore',
      '.eslintignore',
      '.roomodes'
    ],
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js', '**/setupTests.js', '**/teardownGlobal.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
        jest: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-case-declarations': 'off',
    },
  },
  {
    files: ['e2e/**/*.js', 'e2e/**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: [
      '**/*.js',
      '!**/__tests__/**/*.js',
      '!**/*.test.js',
      '!e2e/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]
