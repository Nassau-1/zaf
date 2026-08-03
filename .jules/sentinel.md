## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-06-25 - Path Traversal in Repo Context API
**Vulnerability:** Path traversal in the `/api/repo/context` API due to missing boundary checks when concatenating the `repo` parameter.
**Learning:** Resolving unsanitized paths with `path.resolve` directly into application logic allows arbitrary file reads on the server if no boundary checks are performed.
**Prevention:** Use a dedicated validation helper with a try-catch wrapped `decodeURIComponent` and strict boundary validation using `!resolvedPath.startsWith(basePath + path.sep)`. The helper should return `null` instead of throwing errors to avoid DoS vulnerabilities.
