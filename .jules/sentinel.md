## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-06-25 - Path Traversal in Repo Slug Resolution
**Vulnerability:** Path traversal via unsanitized user inputs (`repoSlug` / `repoName`) directly passed to `path.resolve` combined with `REPOS_ROOT`.
**Learning:** `path.resolve` does not intrinsically prevent directory traversal (`../`) to locations outside a base directory. If user input contains traversal components, it can resolve to arbitrary locations outside `REPOS_ROOT`.
**Prevention:** Implement a secure wrapper like `resolveRepoRoot` that checks `resolved.startsWith(REPOS_ROOT + path.sep)` to ensure the resolved path strictly resides within the base directory.
