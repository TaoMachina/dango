# Security

Dango runs on your computer and drives agents that can read and change your files, so security reports matter.

## Report a problem

Please report a vulnerability privately with GitHub's **Report a vulnerability** button on the Security tab of this repository. Do not open a public issue for it.

Include what an attacker can do, the steps to reproduce it, and your operating system and Dango version. You will get an answer within a week.

## What Dango protects

- The hub listens on `127.0.0.1` only.
- Every API request needs a session cookie, which only the launcher can obtain with the key in `~/.dango/key`, and a loopback `Host` header. This blocks other websites and DNS-rebinding pages.
- Agents that join by pasting an instruction use their own bearer token.
- Agents keep their own permission rules. Dango shows their permission requests and does not answer them on your behalf.

Anything that lets another website, another user on the same computer, or a remote machine reach the hub or an agent through it is in scope.
