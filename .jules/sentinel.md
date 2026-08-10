## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.
## 2026-08-09 - Path Traversal in Repo Paths
**Vulnerability:** Arbitrary path traversal via unsanitized user inputs (`repo`, `repoName`, etc.) passed to `path.resolve(REPOS_ROOT, ...)`. Attackers can access files outside the `REPOS_ROOT` directory using sequences like `../`.
**Learning:** In Node.js, `path.resolve` strictly applies `..` sequence processing, potentially resolving paths completely outside of the intended root directory, which opens the system to sensitive file reads/writes.
**Prevention:** Always validate that the final resolved path still begins with the intended base directory (using strict boundary checks like appending `path.sep` to `basePath`) before using it in file system operations. If it doesn't match, fallback to a safe default.
