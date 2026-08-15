import js from "@eslint/js";

const sharedGlobals = {
  URL: "readonly",
  __dirname: "readonly",
  atob: "readonly",
  beforeEach: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  describe: "readonly",
  document: "readonly",
  expect: "readonly",
  fetch: "readonly",
  globalThis: "readonly",
  it: "readonly",
  navigator: "readonly",
  process: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  window: "readonly",
};

const generatedUiFiles = [
  "app/components/ui/**/*.{js,jsx,mjs,cjs}",
  "app/hooks/use-mobile.js",
];

export default [
  {
    ignores: [
      ".runtime/",
      ".react-router/",
      "build/",
      "coverage/",
      "dist/",
      "node_modules/",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: sharedGlobals,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      sourceType: "module",
    },
    rules: {
      "array-callback-return": "error",
      curly: ["error", "all"],
      "default-case-last": "error",
      "dot-notation": "error",
      eqeqeq: ["error", "always"],
      "no-alert": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-implicit-coercion": "error",
      "no-implied-eval": "error",
      "no-loop-func": "error",
      "no-shadow": "warn",
      "no-undef-init": "error",
      "no-unneeded-ternary": "error",
      "no-useless-concat": "error",
      "no-useless-return": "warn",
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^React$" },
      ],
      "object-shorthand": ["error", "always"],
      "prefer-arrow-callback": "warn",
      "prefer-const": "error",
      "prefer-object-has-own": "error",
      "prefer-template": "error",
      radix: "error",
    },
  },
  {
    files: generatedUiFiles,
    rules: {
      curly: "off",
      eqeqeq: "off",
      "no-implicit-coercion": "off",
      "no-shadow": "off",
      "object-shorthand": "off",
    },
  },
];
