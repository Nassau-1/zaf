## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-11-01 - Poison Null Byte DoS in `decodeURIComponent` Path Handling
**Vulnerability:** A Denial of Service (DoS) vulnerability where decoding URL-encoded paths (e.g., `%00`) in static file servers can result in literal null bytes (`\0`) being passed to Node.js `fs` or `path` functions.
**Learning:** Node.js `fs` and `path` functions synchronously throw a `TypeError` (`ERR_INVALID_ARG_VALUE`) if they encounter a path string containing a null byte. If a server uses `decodeURIComponent` on user input without subsequently checking for null bytes, an attacker can send `/%00` to crash the entire Node.js process.
**Prevention:** Whenever applying `decodeURIComponent` to user-supplied paths before filesystem operations, immediately check for and reject null bytes (e.g., `if (pathname.includes('\0')) { return res.writeHead(400); }`).
