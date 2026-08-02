## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-06-25 - Prevent Path Traversal in Server Route Handlers
**Vulnerability:** Path traversal in HTTP route handlers via `repo` query parameter or JSON payload allowing unauthorized file reads, creations, and updates outside of the target `REPOS_ROOT`.
**Learning:** Using `path.resolve` combined with `path.join` does not sanitize against relative traversal sequences (e.g. `../`) unless explicitly verified. Direct interpolation into system file operations allows reads/writes of sensitive files like `/etc/passwd`. Standard Node HTTP `path.resolve` only evaluates string semantics.
**Prevention:** Implement a central, reusable path resolution function (e.g., `resolveRepoPath`) that uses `path.resolve(REPOS_ROOT, userInput)` and strictly validates that the resulting absolute path still starts with `REPOS_ROOT + path.sep` or matches exactly `REPOS_ROOT`. Apply this to all file system interactions driven by user input.
