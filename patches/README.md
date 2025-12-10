# Patch Distribution for Team Members

## Quick Start

Each team member has their own folder with their assigned patches:

- **mahlet/** - 3 patches (Collaboration Service & Architecture)
- **meseret/** - 3 patches (Database & Email Verification)
- **mikeaddis/** - 3 patches (Infrastructure & Real-time Collaboration)
- **mikeworki/** - 3 patches (Document Service, Redis & Validation)

## Instructions

1. Navigate to your folder: `cd patches/<your-name>/`
2. Follow the instructions below
3. Apply patches in numerical order
4. Push to your branch

## Patch Summary

### Mahlet (3 patches)
1. `0005-update-collab-service-ditributed-even-verification-and-auth-validation-added.patch`
2. `0009-update-doc-save-api-route-fixs.patch`
3. `0011-update-architecure-preview-update.patch`

### Meseret (3 patches)
1. `0002-update-dedicated-database-separation.patch`
2. `0007-update-doc-sharing-issue-fixed.patch`
3. `0010-email-verification-and-validation-added.patch`

### MikeAddis (3 patches)
1. `0001-update-database-clustering-and-distributed-services-setup.patch`
2. `0007-update-doc-sharing-issue-fixed.patch`
3. `0008-fix-real-time-collaboration-via-services-fixed.patch`

### MikeWorki (3 patches)
1. `0003-update-doc-save-api-route-fixs.patch`
2. `0004-Update-document-redis-connection-kafka-replication-and-robustness-set.patch`
3. `0006-fix-validation-fix-for-login.patch`

## Quick Commands

```bash
# For Mahlet
cd Multi-User-Distributed-Text-Editor
git checkout main
git pull origin main
git checkout -b <your-branch-name>
cd patches/mahlet
git am *.patch
git push origin <your-branch-name>

# For Meseret
cd Multi-User-Distributed-Text-Editor
git checkout main
git pull origin main
git checkout -b <your-branch-name>
cd patches/meseret
git am *.patch
git push origin <your-branch-name>

# For MikeAddis
cd Multi-User-Distributed-Text-Editor
git checkout main
git pull origin main
git checkout -b <your-branch-name>
cd patches/mikeaddis
git am *.patch
git push origin <your-branch-name>

# For MikeWorki
cd Multi-User-Distributed-Text-Editor
git checkout main
git pull origin main
git checkout -b <your-branch-name>
cd patches/mikeworki
git am *.patch
git push origin <your-branch-name>
```

## After Applying Patches

Once you've applied your patches:

1. **Verify your commits**:
   ```bash
   git log --oneline -5
   # You should see your commits with YOUR name as the author
   ```

2. **Push to remote**:
   ```bash
   git push origin <your-branch-name>
   ```

3. **Create a Pull Request** on GitHub to merge into `main`

## Troubleshooting

### If `git am` fails with conflicts:

```bash
# 1. Resolve conflicts manually
# Edit the conflicting files

# 2. Add resolved files
git add <conflicted-files>

# 3. Continue applying the patch
git am --continue
```

### If you need to abort a patch application:

```bash
git am --abort
```

## Merge Order

After all team members push their branches, merge PRs in this order:

1. **MikeAddis's PR** (patches 0001, 0007, 0008) - Infrastructure foundation
2. **Meseret's PR** (patches 0002, 0007, 0010) - Database & Email
3. **MikeWorki's PR** (patches 0003, 0004, 0006) - Document, Redis & Validation
4. **Mahlet's PR** (patches 0005, 0009, 0011) - Collaboration & Architecture

## Team Contribution Summary

| Team Member | Patches | Focus Area |
|-------------|---------|------------|
| Mahlet | 3 | Collaboration Service & Architecture Docs |
| Meseret | 3 | Database Separation & Email Verification |
| MikeAddis | 3 | Distributed Infrastructure & Real-time Collaboration |
| MikeWorki | 3 | Document API, Redis Integration & Login Validation |

**Total**: 12 patches distributed evenly across 4 team members (3 each)
