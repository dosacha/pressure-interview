import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'frontend/dist/**', 'frontend/.test/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['frontend/web/**/*.{ts,tsx}', 'frontend/vite.config.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: false, project: './frontend/web/tsconfig.json' },
    },
  },
  {
    files: ['frontend/web/lib/**/*.test.ts'],
    languageOptions: {
      parserOptions: { projectService: false, project: './frontend/tsconfig.test.json' },
    },
  },
);
