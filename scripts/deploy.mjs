import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import console from "node:console";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const artifacts = ["main.js", "manifest.json", "styles.css"];

async function requireDirectory(path, label) {
  try {
    if (!(await stat(path)).isDirectory()) {
      throw new Error(`${label} is not a directory: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) {
      throw error;
    }
    throw new Error(`${label} does not exist: ${path}`, { cause: error });
  }
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error("Usage: npm run deploy -- <obsidian-vault-path>");
  }
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const vault = resolve(process.argv[2]);
  await requireDirectory(vault, "Vault");
  await requireDirectory(
    resolve(vault, ".obsidian"),
    "Obsidian configuration directory",
  );
  const manifest = JSON.parse(
    await readFile(resolve(projectRoot, "manifest.json"), "utf8"),
  );
  if (typeof manifest.id !== "string" || manifest.id.length === 0) {
    throw new Error("manifest.json must contain a plugin id.");
  }
  for (const artifact of artifacts) {
    await stat(resolve(projectRoot, artifact));
  }
  const destination = resolve(vault, ".obsidian", "plugins", manifest.id);
  await mkdir(destination, { recursive: true });
  await Promise.all(artifacts.map((artifact) =>
    copyFile(
      resolve(projectRoot, artifact),
      resolve(destination, artifact),
    )
  ));
  console.log(
    `Deployed ${manifest.name} ${manifest.version} to ${destination}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
