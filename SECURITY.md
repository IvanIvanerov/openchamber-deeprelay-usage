# Security

## What this extension touches

The extension reads the DeepRelay API key that OpenCode holds for the `deeprelay` provider, and sends it to `https://api.deeprelay.ai/v1`. It writes nothing: no key, no usage data, no telemetry, no file of its own.

The key reaches the extension only because OpenChamber hands it over for the provider ids the manifest lists, and only after you approve the `service` capability. The extension logs nothing about it.

## Reporting a vulnerability

Open a private security advisory on the repository (**Security → Report a vulnerability**) rather than a public issue. Include the affected version, what an attacker gains, and how to reproduce it.

You can expect an answer within a week. If a report turns out to need a fix rather than a discussion, a patch and a release follow.

## What is out of scope

- DeepRelay's own API, billing or account security. Report those to DeepRelay.
- OpenChamber's credential store and the approval flow. Report those in the OpenChamber repository.
