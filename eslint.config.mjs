import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "legacy/**",
      "drizzle/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      "coverage/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The engine uses `any` casts narrowly when stringifying schema-shaped
      // values for diff output; allow it project-wide for now.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default config;
