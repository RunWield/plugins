import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPackage, generatedPaths, type Release } from "./package.ts";

interface GitHubRelease {
    tag_name: string;
    draft: boolean;
    prerelease: boolean;
    html_url: string;
}

export function assertForwardRelease(current: Release, next: Release): void {
    const oldParts = current.tag.slice(1).split(".").map(Number);
    const newParts = next.tag.slice(1).split(".").map(Number);
    const difference = newParts.map((part, index) => part - oldParts[index]).find((part) => part !== 0) ?? 0;
    assert(difference >= 0, `Refusing to replace ${current.tag} with older ${next.tag}`);
    if (difference === 0) assert.equal(next.commit, current.commit, "Published source tag moved");
}

if (import.meta.main) {
    const root = resolve(import.meta.dirname, "..");
    const requested = process.argv[2];
    assert(process.argv.length <= 3, "Usage: bun run sync [vX.Y.Z]");
    if (requested) assert.match(requested, /^v\d+\.\d+\.\d+$/);
    const endpoint = requested ? `tags/${requested}` : "latest";
    const released: GitHubRelease = JSON.parse(
        execFileSync("gh", ["api", `repos/RunWield/runwield/releases/${endpoint}`], { encoding: "utf8" }),
    );
    assert(!released.draft && !released.prerelease, "The marketplace tracks published stable releases only");
    assert.match(released.tag_name, /^v\d+\.\d+\.\d+$/);
    if (requested) assert.equal(released.tag_name, requested);
    const temporary = await mkdtemp(join(tmpdir(), "runwield-plugin-release-"));
    try {
        const source = join(temporary, "source");
        const staged = join(temporary, "package");
        execFileSync(
            "git",
            [
                "clone",
                "--quiet",
                "--depth",
                "1",
                "--filter=blob:none",
                "--sparse",
                "--branch",
                released.tag_name,
                "https://github.com/RunWield/runwield.git",
                source,
            ],
            { stdio: "inherit" },
        );
        execFileSync(
            "git",
            [
                "-C",
                source,
                "sparse-checkout",
                "set",
                ".agents/plugins",
                ".claude-plugin",
                "src/attached/codex/plugin",
                "src/attached/claude/plugin",
            ],
            { stdio: "inherit" },
        );
        const release: Release = {
            repository: "RunWield/runwield",
            tag: released.tag_name,
            commit: execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
            url: released.html_url,
        };
        const existing = join(root, "release.json");
        if (await Bun.file(existing).exists())
            assertForwardRelease(JSON.parse(await readFile(existing, "utf8")), release);
        await buildPackage(source, staged, release);
        for (const path of generatedPaths) {
            await rm(join(root, path), { recursive: true, force: true });
            await cp(join(staged, path), join(root, path), { recursive: true });
        }
        console.log(`Prepared connect@runwield from ${release.tag} (${release.commit}).`);
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}
