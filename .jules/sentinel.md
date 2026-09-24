## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-09-23 - Path Traversal via Untrusted Repo Names
**Vulnerability:** Path traversal vulnerability exists because untrusted user input (`repoSlug`) was directly supplied to `path.resolve(REPOS_ROOT, repoSlug)` and `path.join()`. This allows attackers to access arbitrary files on the filesystem by supplying payloads like `../../`.
**Learning:** `path.resolve` and `path.join` do not inherently restrict paths to a base directory. If user input contains `../`, it can resolve outside the intended root directory.
**Prevention:** Always perform boundary validation after resolving paths using untrusted inputs by ensuring the resolved absolute path starts with the expected base directory (e.g., `resolved.startsWith(REPOS_ROOT + path.sep)`).
