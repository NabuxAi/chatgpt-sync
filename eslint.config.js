import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Flat ESLint config (ESLint v9+) for a TypeScript codebase.
// Goal: catch real correctness problems (undeclared vars, unreachable code,
// duplicate keys, etc.) without being noisy about style. `no-unused-vars` is a
// warning so it never fails CI on its own; genuine bugs stay errors. Type-aware
// rules are intentionally not enabled — `tsc --noEmit` owns full type checking.
export default tseslint.config(
  {
    ignores: ["node_modules/**", "tmp/**", "apps/extension/dist/**", "build/**"]
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node
      }
    }
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase intentionally uses `any` for dynamic JSON / DOM payloads.
      "@typescript-eslint/no-explicit-any": "off",
      // Node helper scripts dynamically resolve modules via createRequire().
      "@typescript-eslint/no-require-imports": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ]
    }
  }
);
