# Contributing

Thanks for taking a look. Issues and pull requests are both welcome.

## Before you open a pull request

```bash
npm install
npm test
```

The tests are the contract: the mapping from DeepRelay's numbers to usage windows, and the wire the answer travels over, parsed with the schema from `@openchamber/sdk`. A change that needs new behaviour needs a test that fails without it.

## What a good change looks like

- The mapping stays in `service/lib/deeprelay.js` and stays free of transport. A function that turns DeepRelay's answer into windows should not know what a fetch is.
- The wire stays as OpenChamber defines it. If a change touches the answer, `test/wire.test.js` has to keep passing against the schema from the SDK, not against a copy of it.
- Comments explain why, not what. The code says what it does.
- The README follows the code. If a window appears or disappears, the table in the README follows.

## Reporting a problem

Open an issue with what you expected, what happened instead, and the card's error text if it shows one. The extension's own logs are in OpenChamber's log directory; `~/Library/Logs/OpenChamber/main.log` on macOS.

Never paste an API key into an issue or a pull request. If a report needs it, say which step failed instead.

## Commit messages

```
feat: read the spend limit from the subscription answer
fix: cap the weekly share at the limit
docs: explain the retry budget
```

One logical change per commit, and a message that says why the change was needed.

## Releasing

Versions follow semantic versioning. A release is a tag on `main` and a matching entry in [CHANGELOG.md](CHANGELOG.md); the tag is what the release reads.

```bash
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

The release workflow takes the changelog entry from the tag and publishes it as the release notes.
