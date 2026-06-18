import js from "@eslint/js";
import globals from "globals";

// Flat ESLint config (ESLint v9+).
// Goal: catch real correctness problems (undeclared vars, unreachable code,
// duplicate keys, etc.) without being noisy about style. `no-unused-vars` is a
// warning so it never fails CI on its own; genuine bugs stay errors.
export default [
  {
    ignores: ["node_modules/**", "tmp/**", "dist/**", "build/**"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];
