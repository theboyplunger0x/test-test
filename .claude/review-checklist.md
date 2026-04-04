# Pre-Push Review Checklist

Before pushing, verify ALL of the following:

## Code Quality
- [ ] No hardcoded secrets, API keys, or passwords
- [ ] No console.log left in production code (unless intentional logging)
- [ ] No commented-out code blocks
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)

## Functionality
- [ ] Changes do what was asked — nothing more, nothing less
- [ ] No unrelated files modified
- [ ] Paper/real mode respected where applicable
- [ ] No breaking changes to existing API endpoints

## Deploy Safety
- [ ] Backend deploys from `/backend` dir, NOT from root
- [ ] Frontend deploys from project root, NOT from `/backend`
- [ ] No UTF-8/encoding corruption in source files
- [ ] Build passes (`next build` for frontend, `tsc` for backend)

## UX
- [ ] No visual regressions (check the actual UI, not just code)
- [ ] Mobile responsive not broken
- [ ] Dark mode still works
