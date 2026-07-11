module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    'no-async-promise-executor': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        args: 'none',
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_',
      },
    ],
  },
};
