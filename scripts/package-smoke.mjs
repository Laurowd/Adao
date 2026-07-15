import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
let temporaryDirectory;
let tarballPath;

try {
  const sourcePackage = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8")
  );
  const tarballFilename = `${sourcePackage.name
    .replace(/^@/, "")
    .replaceAll("/", "-")}-${sourcePackage.version}.tgz`;
  tarballPath = path.join(repositoryRoot, tarballFilename);

  await rm(path.join(repositoryRoot, "dist"), {
    recursive: true,
    force: true
  });
  await rm(tarballPath, { force: true });

  run(npmExecutable, ["pack"], { cwd: repositoryRoot });

  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack did not create ${tarballFilename}.`);
  }

  const packagedFiles = listTarballFiles(await readFile(tarballPath));
  assertPackageContents(packagedFiles);

  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "adao-package-"));
  run(npmExecutable, ["init", "--yes"], { cwd: temporaryDirectory });
  run(
    npmExecutable,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarballPath
    ],
    { cwd: temporaryDirectory }
  );

  const binaryPath = path.join(
    temporaryDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "adao.cmd" : "adao"
  );
  const help = run(binaryPath, ["--help"], { cwd: temporaryDirectory });
  const version = run(binaryPath, ["--version"], { cwd: temporaryDirectory });
  if (!help.includes("Usage:") || !help.includes("adao scan")) {
    throw new Error("Installed adao --help output is incomplete.");
  }

  if (version.trim() !== sourcePackage.version) {
    throw new Error(
      `Installed adao --version returned ${JSON.stringify(version.trim())}; expected ${sourcePackage.version}.`
    );
  }

  const fixturePath = path.join(temporaryDirectory, "fixture");
  await mkdir(fixturePath);
  await writeFile(
    path.join(fixturePath, "package.json"),
    JSON.stringify({ name: "package-smoke-fixture" }),
    "utf8"
  );
  await writeFile(path.join(fixturePath, "index.ts"), "export {};\n", "utf8");

  const scan = run(binaryPath, ["scan", fixturePath], {
    cwd: temporaryDirectory
  });

  if (
    !scan.includes("Project: package-smoke-fixture") ||
    !scan.includes("Languages: TypeScript")
  ) {
    throw new Error("Installed adao scan did not inspect the fixture correctly.");
  }

  const installedRoot = path.join(
    temporaryDirectory,
    "node_modules",
    "@laurowd",
    "adao"
  );

  if (
    existsSync(path.join(installedRoot, "src")) ||
    existsSync(path.join(installedRoot, "tests")) ||
    existsSync(path.join(temporaryDirectory, "node_modules", "tsx"))
  ) {
    throw new Error("Installed package contains source, tests, or runtime tsx.");
  }

  console.log(`Packed ${tarballFilename}`);
  console.log(`Package files (${packagedFiles.length}):`);
  for (const file of packagedFiles) {
    console.log(`  ${file}`);
  }
  console.log(`Installed adao --version: ${version.trim()}`);
  console.log("Installed adao --help: ok");
  console.log("Installed adao scan fixture: ok");
  console.log("Runtime dependency on tsx/devDependencies: none detected");
} finally {
  if (tarballPath) {
    await rm(tarballPath, { force: true });
  }
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: path.join(os.tmpdir(), "adao-npm-cache")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}.\n${result.stderr || result.stdout}`
    );
  }

  return result.stdout;
}

function assertPackageContents(files) {
  const requiredFiles = [
  "README.md",
  "README.pt-BR.md",
  "LICENSE",
  "package.json",
  "dist/cli.js"
];
  const forbiddenPatterns = [
    /^(?:src|tests|scripts|coverage)\//,
    /^AGENTS\.md(?:\.bak(?:\.\d+)?)?$/,
    /adao\.tmp/,
    /^(?:tsconfig\.json|\.gitignore)$/
  ];

  for (const requiredFile of requiredFiles) {
    if (!files.includes(requiredFile)) {
      throw new Error(`Tarball is missing required file ${requiredFile}.`);
    }
  }

  const unexpectedFile = files.find(
  (file) =>
    !file.startsWith("dist/") &&
    file !== "README.md" &&
    file !== "README.pt-BR.md" &&
    file !== "package.json" &&
    !/^LICENSE(?:\.|$)/i.test(file)
);
  const forbiddenFile = files.find((file) =>
    forbiddenPatterns.some((pattern) => pattern.test(file))
  );

  if (unexpectedFile || forbiddenFile) {
    throw new Error(
      `Tarball contains unexpected file ${unexpectedFile ?? forbiddenFile}.`
    );
  }
}

function listTarballFiles(compressedTarball) {
  const tarball = gunzipSync(compressedTarball);
  const files = [];
  let offset = 0;

  while (offset + 512 <= tarball.length) {
    const header = tarball.subarray(offset, offset + 512);
    const name = readTarString(header, 0, 100);

    if (!name) {
      break;
    }

    const prefix = readTarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = readTarString(header, 124, 12).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const type = String.fromCharCode(header[156]);

    if (type === "0" || type === "\0") {
      files.push(fullName.replace(/^package\//, ""));
    }

    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return files.sort();
}

function readTarString(header, offset, length) {
  const end = header.indexOf(0, offset);
  const boundedEnd = end === -1 || end > offset + length ? offset + length : end;
  return header.toString("utf8", offset, boundedEnd);
}
