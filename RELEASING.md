# Releasing Guide

This repository uses a simple release discipline for user-facing changes.

## 1) Changelog first

For each release, update `CHANGELOG.md` with:

- Version + date
- Added / Changed / Fixed (as applicable)
- **Upgrade Notes** section when there are breaking or migration-relevant changes

## 2) Tag releases

After merging release-ready changes on `main`:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

## 3) Upgrade Notes policy (mandatory when needed)

Add **Upgrade Notes** when any of the following applies:

- Breaking API/CLI/config changes
- Required data migration
- Behavior changes that may affect existing users/workflows
- Dependency major bumps with compatibility impact

If no migration/breaking changes exist, explicitly write:

- `Upgrade Notes: None`

## 4) Keep consistency

- Use SemVer (`MAJOR.MINOR.PATCH`)
- Keep wording concise and user-facing
- Avoid shipping user-visible changes without changelog entry + tag
