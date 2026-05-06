# Contributing to Tessera

Thanks for your interest in Tessera. Small, focused issues and pull requests are the easiest to review.

## Issues

Use the bug or feature template. Screenshots, recordings, and clear reproduction steps are especially helpful. For npm or source installs, include Node.js only when it seems relevant.

## Pull Requests

- Open pull requests against `main`.
- Keep changes focused.
- Open an issue first for larger features, new provider integrations, workflow changes, or architecture changes.
- Do not include secrets, private prompts, API keys, tokens, private repository names, or sensitive logs.

## Cross-Platform Support

Tessera supports the npm runtime and desktop builds across Windows, macOS, and Linux. When changing runtime, filesystem, process spawning, shell, path, Electron, or CLI-provider behavior, keep cross-platform behavior in mind.

Test on the platforms you can access, and note what you tested in the PR. If you could not test a relevant platform, mention that too.

## Source Setup

```bash
npm install
npm run dev
```

The dev server runs through `server.ts` on port `3100` by default. Do not run `next dev` directly.

## Checks

For code changes, run the checks that match your change:

```bash
npm run lint
npx tsc --noEmit
NODE_ENV=production npm run build
```

For UI changes, include screenshots or a short recording.

## Code Guidelines

- Keep provider-specific behavior behind the CLI provider interfaces.
- Prefer existing local patterns over new abstractions.
- Avoid broad refactors in feature or bugfix PRs.
