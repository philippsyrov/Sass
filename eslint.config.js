/**
 * ESLint flat config — catches real bugs, ignores style.
 */
export default [
  {
    files: ['src/**/*.js'],

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        Map: 'readonly',
      },
    },

    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-self-assign': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-var': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
    },
  },
];
