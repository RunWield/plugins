# RunWield plugins

Install **RunWield Connect** in Codex or Claude Code to plan, review, implement, validate, and deliver a request.
The plugin is `connect`; the marketplace is `runwield`.

This small repository distributes packages from published RunWield releases. Source development belongs in
[RunWield/runwield](https://github.com/RunWield/runwield). Connect remains a Preview; a stable Core release does not
establish complete workflow qualification for every host.

## Install

Install compatible [RunWield Core](https://runwield.dev) first. The `wld` command must be on PATH. You also need Git,
a browser, and your host's own model access. The plugin does not install Core or require a RunWield account.

### Codex

```sh
codex plugin marketplace add RunWield/plugins
codex plugin add connect@runwield
```

Start a new chat in your project, then invoke `$connect:run` with your request.

### Claude Code

```text
/plugin marketplace add RunWield/plugins
/plugin install connect@runwield
```

Restart Claude Code if prompted. Start a request with `/connect:request`; resume implementation with
`/connect:implement`, Plan review with `/connect:plan-review`, or validation with `/connect:validate`.

## Update

Update Core using its original installer or package manager. In Codex:

```sh
codex plugin marketplace upgrade runwield
codex plugin remove connect@runwield
codex plugin add connect@runwield
```

Reinstallation refreshes package files even when the adapter version is unchanged. Codex removal can reset plugin
tool permissions; review your preferences after reinstalling. Start a new chat to load the new package.

In Claude Code, update the marketplace and plugin using `/plugin marketplace update runwield` and
`/plugin update connect@runwield`. If the adapter version is unchanged, uninstall and reinstall the plugin to refresh
its cached files.

## Migrate from the old marketplace

The marketplace identity stays `runwield`; the plugin changes from `runwield` to `connect`. Remove the old plugin to
avoid loading two MCP servers. For Codex:

```sh
codex plugin remove runwield@runwield
codex plugin marketplace add RunWield/plugins
codex plugin add connect@runwield
```

For Claude Code, uninstall `runwield@runwield`, remove the old `runwield` marketplace, then follow the installation
commands above. These operations do not delete Core's Plans or saved workflows. Review permissions for the new plugin.

## Release maintenance

`release.json` identifies the upstream release tag, exact source commit, and SHA-256 hashes of every distributed file.
The default branch tracks stable Core releases only. Prereleases remain available through the upstream marketplace
with an explicit release ref; they do not replace this repository's default package.

The **Sync stable release** workflow checks GitHub's latest stable RunWield release hourly and supports manual dispatch
with an explicit stable tag. It uses this repository's `GITHUB_TOKEN`; no cross-repository write credential is needed.
It rejects downgrades and moved source tags, validates the package, then publishes generated files and a matching Git
tag. Scheduled runs can be delayed; GitHub disables schedules after 60 days of repository inactivity. Use manual
dispatch to recover or publish immediately.

Local maintenance requires Bun 1.4.3, Git, and an authenticated GitHub CLI. There are no package dependencies:

```sh
bun run sync v0.14.4
bun run check
bun run test
```

The exporter copies both host packages and their license from the released source. Its only package changes are the
manifest name (`connect`) and command examples (`$connect:` or `/connect:`). It preserves adapter versions, contracts,
MCP launch configuration, and host policy metadata. Marketplace entries point at `plugins/codex` and `plugins/claude`.
Do not hand-edit generated files; change workflow behavior upstream and publish a new release.

Package validation and installation checks do not establish a completed Connect workflow. Report product issues in
[RunWield/runwield](https://github.com/RunWield/runwield/issues).
