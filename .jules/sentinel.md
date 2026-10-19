## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2024-10-20 - [CRITICAL] Prevent Path Traversal in Repository Resolution
**Vulnerability:** The dashboard server resolved repository paths using `path.resolve(REPOS_ROOT, repoSlug)` where `repoSlug` was derived from user input without validation. This allowed an attacker to traverse out of the `REPOS_ROOT` using relative paths (e.g., `../../etc/passwd`).
**Learning:** `path.resolve` automatically normalizes `../` sequences. If `repoSlug` starts with `../`, it goes up from `REPOS_ROOT`. It is critical to enforce containment *after* resolution, ensuring the resolved path resides strictly within the expected parent directory.
**Prevention:** Always validate resolved paths by verifying they start with the intended root directory plus a path separator (e.g., `resolved.startsWith(ROOT + path.sep)`) or exactly match the root itself (e.g., `resolved === ROOT`). To avoid DoS crashes from throwing errors synchronously, return a securely invalid placeholder path (e.g., `__INVALID_PATH__`) so downstream `fs` checks naturally and safely fail.
