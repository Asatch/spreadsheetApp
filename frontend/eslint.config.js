import js from '@eslint/js'
import globals from 'globals'
import cypress from 'eslint-plugin-cypress'

export default [
  {
    ignores: [
      'dist',
      'cypress.config.js',
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
    files: ['cypress/**/*.js'],
    languageOptions: {
      globals: {
        cy: 'readonly',
        Cypress: 'readonly',
        before: 'readonly',
        beforeEach: 'readonly',
        after: 'readonly',
        afterEach: 'readonly',
        context: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
      },
    },
    plugins: {
      cypress: cypress,
    },
    rules: {
      ...cypress.configs.recommended.rules,
      'no-unused-vars': 'off',
      'no-case-declarations': 'off',
    },
  },
  {
    files: [
      '**/*.js',
      '!**/__tests__/**/*.js',
      '!**/*.test.js',
      '!cypress/**/*.js',
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
