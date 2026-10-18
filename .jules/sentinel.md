## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-06-25 - Path Traversal in Repo Context Resolution
**Vulnerability:** Arbitrary path traversal due to unsanitized user inputs passed to `path.resolve(REPOS_ROOT, ...)` and `path.join(REPOS_ROOT, ...)`.
**Learning:** Node.js `path.resolve` and `path.join` implicitely normalize paths, but lack inherent boundaries. Decoding URLs and ensuring `startsWith` with a trailing path separator is necessary to prevent traversal and bypasses.
**Prevention:** Always decode user input and validate containment against the intended base directory using `startsWith(ROOT + path.sep)` or exact equality before accessing the filesystem.
