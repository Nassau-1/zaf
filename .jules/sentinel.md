## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.
## 2026-06-25 - Path Traversal in Server Route Resolution
**Vulnerability:** The ZAF control plane `server.js` suffers from path traversal because `path.resolve(REPOS_ROOT, repoSlug)` blindly accepts arbitrary inputs with `..` allowing traversal outside `REPOS_ROOT`.
**Learning:** Resolving user input paths directly using `path.resolve` relative to a base directory does not enforce boundaries. An attacker can supply a path like `../../../../../etc` and escape the base directory completely.
**Prevention:** Explicit boundary checking must be used. Either verify that `(repoSlug || '').includes('..') === false`, or enforce boundary checks using `resolvedPath.startsWith(REPOS_ROOT + path.sep)`.
