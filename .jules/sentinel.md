## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2024-10-12 - Prevent Path Traversal in Repo Resolvers
**Vulnerability:** Several API endpoints in `dashboard/server.js` use user-provided `repo` or `repoSlug` variables directly in `path.resolve(REPOS_ROOT, repoSlug)` or `path.join(REPOS_ROOT, repoSlug, ...)` without validating if the resolved path escapes the `REPOS_ROOT` directory.
**Learning:** Using `path.resolve` or `path.join` with unsanitized user input allows path traversal (e.g., passing `../../etc` as the repo slug). Node's `path` module does not intrinsically prevent escaping the base directory. Path inputs must be URI-decoded before validation to prevent `%2e%2e` bypasses.
**Prevention:** Always sanitize user-provided path segments before resolving them against a root directory. Create a wrapper function that explicitly checks `resolved.startsWith(ROOT + path.sep)` to ensure the resolved path remains within the intended boundary, returning a safe/invalid fallback path if traversal is detected.
