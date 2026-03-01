// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  { files: ['scripts/**/*.js'], languageOptions: { globals: globals.node } },
  { ignores: ['dist/', 'demo/dist/'] },
);
