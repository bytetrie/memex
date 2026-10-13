import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import { defineConfig, globalIgnores } from "eslint/config";
import nounsanitized from "eslint-plugin-no-unsanitized";
import security from "eslint-plugin-security";
import globals from "globals";
import tseslint from "typescript-eslint";

const CHILD_PROCESS_WRAPPER = "src/server/node/child-process.ts";
const viaWrapper = `start processes through ${CHILD_PROCESS_WRAPPER} only`;
const noDynamicChildProcess = {
  selector: "ImportExpression[source.value=/^(node:)?child_process$/]",
  message: viaWrapper,
};

export default defineConfig(
  // static/ is Vite's build output; vendor/ holds the pinned third-party yt-dlp build (scripts/yt-dlp.ts).
  globalIgnores(["static/", "test-results/", "web/public/", "vendor/"]),
  { linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" } },
  comments.recommended,
  { rules: { "@eslint-community/eslint-comments/require-description": ["error", { ignore: ["eslint-enable"] }] } },

  // All TypeScript, server and browser: the type-aware rules.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "no-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-implied-eval": "error", // the preset's type-aware no-implied-eval
      // Already errors in strict-type-checked; listed so that loosening the preset can't drop them.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-declaration-merging": "error",
      "@typescript-eslint/no-unsafe-enum-assignment": "error",
      "@typescript-eslint/no-unsafe-enum-comparison": "error",
      "@typescript-eslint/no-unsafe-function-type": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      // Not in the preset. A cast that narrows a type (`JSON.parse(body) as User`) is a claim
      // nothing checks: validate the data instead, or disable this line with the reason it is safe.
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      // `{ ... } as T` hides missing fields; annotate instead (`const x: T = { ... }`).
      "@typescript-eslint/consistent-type-assertions": ["error", {
        assertionStyle: "as",
        objectLiteralTypeAssertions: "never",
        arrayLiteralTypeAssertions: "never",
      }],
      "no-restricted-imports": ["error", { paths: [
        { name: "child_process", message: viaWrapper },
        { name: "node:child_process", message: viaWrapper },
      ] }],
      "no-restricted-syntax": ["error", noDynamicChildProcess],
      // TanStack Router's loaders and params signal a 404 or a redirect by throwing these objects.
      "@typescript-eslint/only-throw-error": ["error", { allow: [
        { from: "package", package: "@tanstack/router-core", name: ["NotFoundError", "Redirect"] },
      ] }],
    },
  },

  // Server, scripts, tests, tool configs: Node risks.
  { files: ["**/*.ts"], ignores: ["web/**"], extends: [security.configs.recommended] },

  // The React app: no HTML from strings.
  {
    files: ["web/src/**/*.{ts,tsx}"],
    extends: [nounsanitized.configs.recommended],
    rules: {
      // A later block replaces a rule's settings rather than adding to them,
      // so the child_process entry has to be repeated here.
      "no-restricted-syntax": ["error", noDynamicChildProcess, {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message: "dangerouslySetInnerHTML puts an HTML string into the page; render elements instead",
      }],
    },
  },

  // The one file allowed to launch processes.
  {
    files: [CHILD_PROCESS_WRAPPER],
    rules: { "no-restricted-imports": "off", "no-restricted-syntax": "off", "security/detect-child-process": "off" },
  },

  // The archive's files on disk. Every path is the store's root joined with a validated sha256
  // (pathOf), a random uuid or a name read from the store's own folders; the test uses a temp dir.
  {
    files: ["src/server/node/blob-store.ts", "src/server/node/blob-store.test.ts"],
    rules: { "security/detect-non-literal-fs-filename": "off" },
  },

  // Plain JS tool configs (web/postcss.config.js).
  { files: ["**/*.js"], extends: [js.configs.recommended], languageOptions: { globals: globals.node } },
);
