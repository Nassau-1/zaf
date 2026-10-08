## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-10-07 - Fix Path Traversal in Repository File Operations
**Vulnerability:** User-provided inputs (`repoSlug`, `repoName`) in `dashboard/server.js` were directly passed to `path.resolve` and `path.join` operations against `REPOS_ROOT`. An attacker could exploit this by using directory traversal sequences (e.g., `../../etc`) to bypass the intended root directory, gaining arbitrary file read/write capabilities or DoS via crash.
**Learning:** Resolving unvalidated user inputs against a root directory using `path.resolve` or `path.join` does not confine the result to the root directory. Node.js `fs` operations accept absolute paths outside the root directory, bypassing naive directory boundaries. Path traversal using `%2e%2e` URL-encoded strings bypasses naïve string replacement mitigation.
**Prevention:** Always use `decodeURIComponent` on user input, resolve the absolute path, and validate that the resolved absolute path starts strictly with the exact intended root directory appended with `path.sep` (e.g., `resolved.startsWith(ROOT + path.sep)`) or is exactly the root itself. Never throw synchronous errors; instead, catch decoding errors and return a known invalid path so downstream `fs` operations cleanly fail with `ENOENT`.
