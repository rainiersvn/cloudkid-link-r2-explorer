# CLAUDE.md

## Git Workflow

- **Never commit directly to `main`.** Always create a feature branch for changes.
- **Run `pnpm lint` before every commit.** Fix any lint errors before committing.

## Changesets

Not required. Nothing consumes them: the release workflow that ran
`changeset version` was retired, so a changeset would sit in `.changeset/`
unread and no `CHANGELOG.md` is generated. Describe user-facing changes in the
commit message and PR description instead.

The tooling and config are still installed, so this can be reversed by
restoring the `pull_request` trigger in `.github/workflows/changeset-check.yml`
and re-enabling a workflow that versions.

## Workflows

- `deploy.yml` — the only workflow that runs on push to `main`. Deploys the
  worker and dashboard to Cloudflare.
- `build.yml` — lint, build, unit tests and Playwright, on pull requests. This
  is the regression net; `deploy` does not gate on it, so a merge with a red
  build still ships.
- `changeset-check.yml`, `publish.yml`, `deploy-pages-devtest.yml` — disabled,
  `workflow_dispatch` only.

## Testing

- **Any UI changes must be covered by E2E tests.** Playwright E2E tests live in `packages/dashboard/e2e/`. Run them with `pnpm test:e2e`.
- Run component tests with `pnpm --filter r2-explorer-dashboard test`.
- Run all tests (worker + dashboard) with `pnpm test`.
