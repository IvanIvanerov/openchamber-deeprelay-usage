# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-13

### Added

- A DeepRelay card on OpenChamber's Usage page, next to the built-in providers.
- Monthly input and output meters against the plan allowance, with the period's reset date.
- Weekly input and output meters for the rolling seven-day caps.
- The metered-usage ceiling in dollars.
- The monthly web-search allowance.
- The wallet balance.
- A per-model breakdown of what each model took of the plan.
- A service that reads DeepRelay's billing endpoints with the credential OpenCode already holds for the `deeprelay` provider, and keeps the key out of its own storage.
