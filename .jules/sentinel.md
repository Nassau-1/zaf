## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2025-05-24 - Fix Path Traversal in Dashboard Endpoints
**Vulnerability:** Endpoints handling repository paths (e.g. `/api/repo/import`, `/api/ticket/:id/status`) lacked sanitization and strict validation of the `repoSlug` parameter, allowing an attacker to navigate outside the intended `REPOS_ROOT` directory using sequences like `../` or URL encoded versions (`%2e%2e%2f`).
**Learning:** Directly concatenating or resolving user-supplied paths using `path.resolve` or `path.join` without verifying the resulting absolute path against the allowed root directory allows path traversal. Specifically, failing to append the path separator (`path.sep`) to the root when using `.startsWith()` introduces sibling directory traversal risks. URL-encoded payloads can bypass simple string matching.
**Prevention:** Always decode user input using `decodeURIComponent`. Resolve the path using `path.resolve`, and validate it either exactly matches the root directory or strictly starts with the root directory followed by a path separator (`REPOS_ROOT + path.sep`). Create centralized helper functions for resolving and validating paths.
