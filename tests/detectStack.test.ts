import { describe, expect, it } from "vitest";
import { detectFrameworksAndTools } from "../src/core/detectStack.js";

describe("detectFrameworksAndTools", () => {
  it("detects Fastify from dependencies", () => {
    expect(
      detectFrameworksAndTools({ dependencies: { fastify: "^5.0.0" } })
    ).toEqual(["Fastify"]);
  });

  it("detects the postgres package as PostgreSQL", () => {
    expect(
      detectFrameworksAndTools({ dependencies: { postgres: "^3.0.0" } })
    ).toEqual(["PostgreSQL"]);
  });

  it("detects Cypress from devDependencies", () => {
    expect(
      detectFrameworksAndTools({ devDependencies: { cypress: "^15.0.0" } })
    ).toEqual(["Cypress"]);
  });

  it("detects the three technologies together in deterministic order", () => {
    expect(
      detectFrameworksAndTools({
        dependencies: {
          postgres: "^3.0.0",
          fastify: "^5.0.0"
        },
        devDependencies: { cypress: "^15.0.0" }
      })
    ).toEqual(["Fastify", "PostgreSQL", "Cypress"]);
  });

  it("does not match absent dependencies or similarly named packages", () => {
    expect(
      detectFrameworksAndTools({
        dependencies: {
          "fastify-plugin": "^5.0.0",
          "postgres-types": "^2.0.0"
        },
        devDependencies: { "@cypress/request": "^3.0.0" }
      })
    ).toEqual([]);
  });

  it("preserves detection of existing technologies across dependency groups", () => {
    expect(
      detectFrameworksAndTools({
        dependencies: { react: "^19.0.0", next: "^15.0.0" },
        devDependencies: { vite: "^6.0.0", vitest: "^3.0.0" },
        peerDependencies: { express: "^5.0.0", "@nestjs/core": "^11.0.0" },
        optionalDependencies: {
          prisma: "^6.0.0",
          tailwindcss: "^4.0.0",
          jest: "^30.0.0",
          "@playwright/test": "^1.0.0",
          eslint: "^9.0.0",
          prettier: "^3.0.0"
        }
      })
    ).toEqual([
      "React",
      "Next.js",
      "Vite",
      "Express",
      "NestJS",
      "Prisma",
      "Tailwind CSS",
      "Vitest",
      "Jest",
      "Playwright",
      "ESLint",
      "Prettier"
    ]);
  });
});
