import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export interface Release {
    repository: string;
    tag: string;
    commit: string;
    url: string;
}

interface Manifest {
    name: string;
    version: string;
}

interface Provenance extends Release {
    files: Record<string, string>;
}

interface CodexMarketplace {
    name: string;
    plugins: { name: string; source: { source: string; path: string } }[];
}

interface ClaudeMarketplace {
    name: string;
    plugins: { name: string; source: string }[];
}

export const generatedPaths = ["plugins", ".agents", ".claude-plugin", "LICENSE", "release.json"];

export async function filesUnder(root: string, prefix = ""): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
        const path = join(prefix, entry.name);
        assert(!entry.isSymbolicLink(), `Plugin symlinks are not supported: ${path}`);
        if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
        else {
            assert(entry.isFile(), `Unsupported file: ${path}`);
            files.push(path);
        }
    }
    return files.sort();
}

async function writeJson(path: string, value: Release | Provenance | Manifest | CodexMarketplace | ClaudeMarketplace) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 4) + "\n");
}

async function inventory(root: string): Promise<Record<string, string>> {
    const files = ["LICENSE"];
    for (const path of ["plugins", ".agents", ".claude-plugin"]) {
        files.push(...(await filesUnder(join(root, path))).map((file) => join(path, file)));
    }
    const hashes: Record<string, string> = {};
    for (const file of files.sort()) {
        hashes[file] = createHash("sha256")
            .update(await readFile(join(root, file)))
            .digest("hex");
    }
    return hashes;
}

export async function buildPackage(source: string, destination: string, release: Release): Promise<void> {
    assert.match(release.tag, /^v\d+\.\d+\.\d+$/, "Only stable releases may populate this marketplace");
    assert.match(release.commit, /^[a-f0-9]{40}$/);
    for (const host of ["codex", "claude"]) {
        const input = join(source, "src/attached", host, "plugin");
        const output = join(destination, "plugins", host);
        for (const file of await filesUnder(input)) {
            const target = join(output, file);
            await mkdir(dirname(target), { recursive: true });
            let contents = await readFile(join(input, file));
            if (file.endsWith(".md")) {
                contents = Buffer.from(
                    contents
                        .toString("utf8")
                        .replaceAll("$runwield:", "$connect:")
                        .replaceAll("/runwield:", "/connect:"),
                );
            }
            await writeFile(target, contents);
        }
        const manifestPath = join(output, `.${host}-plugin/plugin.json`);
        const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        assert(["runwield", "connect"].includes(manifest.name), "Unexpected upstream plugin identity");
        manifest.name = "connect";
        // Adapter versions participate in Core's compatibility checks. Preserve them.
        await writeJson(manifestPath, manifest);
    }
    await mkdir(join(destination, ".agents/plugins"), { recursive: true });
    await mkdir(join(destination, ".claude-plugin"), { recursive: true });
    await writeFile(join(destination, "LICENSE"), await readFile(join(source, "LICENSE")));
    // Preserve host-specific catalog policy and metadata; change only the entry identity and path.
    const codex: CodexMarketplace = JSON.parse(
        await readFile(join(source, ".agents/plugins/marketplace.json"), "utf8"),
    );
    const codexEntry = codex.plugins.find((plugin) => ["runwield", "connect"].includes(plugin.name));
    assert(codex.name === "runwield" && codexEntry, "Missing RunWield Codex catalog entry");
    codexEntry.name = "connect";
    codexEntry.source = { source: "local", path: "./plugins/codex" };
    codex.plugins = [codexEntry];
    await writeJson(join(destination, ".agents/plugins/marketplace.json"), codex);
    const claude: ClaudeMarketplace = JSON.parse(
        await readFile(join(source, ".claude-plugin/marketplace.json"), "utf8"),
    );
    const claudeEntry = claude.plugins.find((plugin) => ["runwield", "connect"].includes(plugin.name));
    assert(claude.name === "runwield" && claudeEntry, "Missing RunWield Claude catalog entry");
    claudeEntry.name = "connect";
    claudeEntry.source = "./plugins/claude";
    claude.plugins = [claudeEntry];
    await writeJson(join(destination, ".claude-plugin/marketplace.json"), claude);
    await writeJson(join(destination, "release.json"), { ...release, files: await inventory(destination) });
    await checkPackage(destination);
}

export async function checkPackage(root: string): Promise<void> {
    const release: Provenance = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
    assert.equal(release.repository, "RunWield/runwield");
    assert.match(release.tag, /^v\d+\.\d+\.\d+$/);
    assert.match(release.commit, /^[a-f0-9]{40}$/);
    assert.equal(release.url, `https://github.com/RunWield/runwield/releases/tag/${release.tag}`);
    assert.deepEqual(await inventory(root), release.files, "Generated files differ from their release hashes");
    const codex: CodexMarketplace = JSON.parse(await readFile(join(root, ".agents/plugins/marketplace.json"), "utf8"));
    const claude: ClaudeMarketplace = JSON.parse(await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8"));
    assert.equal(codex.name, "runwield");
    assert.equal(claude.name, "runwield");
    assert.deepEqual(
        codex.plugins.map((entry) => [entry.name, entry.source.source, entry.source.path]),
        [["connect", "local", "./plugins/codex"]],
    );
    assert.deepEqual(
        claude.plugins.map((entry) => [entry.name, entry.source]),
        [["connect", "./plugins/claude"]],
    );
    for (const host of ["codex", "claude"]) {
        const directory = join(root, "plugins", host);
        const manifest: Manifest = JSON.parse(await readFile(join(directory, `.${host}-plugin/plugin.json`), "utf8"));
        assert.equal(manifest.name, "connect");
        assert.match(manifest.version, /^\d+\.\d+\.\d+/);
        for (const file of await filesUnder(directory)) {
            if (file.endsWith(".json")) JSON.parse(await readFile(join(directory, file), "utf8"));
            if (!file.endsWith(".md")) continue;
            const text = await readFile(join(directory, file), "utf8");
            assert(!/[$/]runwield:/.test(text), `Old command namespace in ${file}`);
            for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
                const link = match[1];
                if (/^(?:https?:|#)/.test(link)) continue;
                const target = join(dirname(join(directory, file)), link.split("#")[0]);
                assert(!relative(directory, target).startsWith(".."), `Link escapes plugin: ${link}`);
                await readFile(target);
            }
        }
    }
}

if (import.meta.main) {
    await checkPackage(process.cwd());
    console.log("Both connect@runwield catalogs, package files, links, and release hashes are valid.");
}
