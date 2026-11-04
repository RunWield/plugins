import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPackage, checkPackage, type Release } from "./package.ts";
import { assertForwardRelease } from "./sync.ts";

const root = resolve(import.meta.dirname, "..");
await checkPackage(root);
const release: Release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
assertForwardRelease(release, release);
assert.throws(() => assertForwardRelease(release, { ...release, commit: "f".repeat(40) }), /tag moved/);
assert.throws(() => assertForwardRelease(release, { ...release, tag: "v0.0.0" }), /older/);
assertForwardRelease(release, { ...release, tag: "v999.0.0" });

const temporary = await mkdtemp(join(tmpdir(), "runwield-plugin-tests-"));
try {
    const source = join(temporary, "source");
    const output = join(temporary, "output");
    for (const path of [".agents", ".claude-plugin", "LICENSE"]) {
        await mkdir(source, { recursive: true });
        await cp(join(root, path), join(source, path), { recursive: true });
    }
    for (const host of ["codex", "claude"]) {
        await cp(join(root, "plugins", host), join(source, "src/attached", host, "plugin"), { recursive: true });
    }
    // Exercise actual old-name migration, including nested skill references.
    const manifestPath = join(source, "src/attached/codex/plugin/.codex-plugin/plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.name = "runwield";
    await writeFile(manifestPath, JSON.stringify(manifest));
    const example = join(source, "src/attached/codex/plugin/skills/run/example.md");
    await writeFile(example, "Use $runwield:run; keep the RunWield brand and runwield MCP server name.\n");
    await buildPackage(source, output, release);
    assert.equal(
        await readFile(join(output, "plugins/codex/skills/run/example.md"), "utf8"),
        "Use $connect:run; keep the RunWield brand and runwield MCP server name.\n",
    );
    const packaged = JSON.parse(await readFile(join(output, "plugins/codex/.codex-plugin/plugin.json"), "utf8"));
    assert.equal(packaged.version, manifest.version, "Adapter version must not be changed by distribution");
    for (const host of ["codex", "claude"]) {
        assert.equal(
            await readFile(join(output, "plugins", host, ".mcp.json"), "utf8"),
            await readFile(join(root, "plugins", host, ".mcp.json"), "utf8"),
        );
    }
    await assert.rejects(
        buildPackage(source, join(temporary, "prerelease"), { ...release, tag: "v1.0.0-rc.1" }),
        /stable/,
    );
    await writeFile(join(output, "plugins/codex/unexpected.txt"), "untracked package content");
    await assert.rejects(checkPackage(output), /release hashes/);
    await rm(join(output, "plugins/codex/unexpected.txt"));
    await writeFile(example, "[Missing instructions](missing.md)\n");
    await assert.rejects(buildPackage(source, join(temporary, "broken"), release), /ENOENT/);
    console.log(
        "Passed: package integrity, namespace migration, MCP/version preservation, missing links, prereleases, rollback, and moved-tag checks.",
    );
} finally {
    await rm(temporary, { recursive: true, force: true });
}
