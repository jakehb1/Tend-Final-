# tend CLI (local sandbox)

A zero-dependency Python implementation of the `tend` CLI advertised in the
docs. Everything runs locally against a state file in `~/.tend/`. No network,
no backend, no signup. The goal is to let people actually run the commands
from the docs and see real output.

## Install

```sh
pip install -e ./cli
tend --version
```

Requires Python 3.9+.

## Quick tour

```sh
tend login --workspace demo
tend init --from-warehouse snowflake://demo/prod.analytics --out ./schema
tend lint
tend plan --target staging
tend deploy --target staging
tend runs tail --agent renewal-risk-v3
```

Everything writes to `~/.tend/` and the current working directory. To reset,
delete `~/.tend/` and `./.tend/`.

## What's real vs. mocked

Real: reading/writing `tend.toml`, `schema/*.tend`, `policies/*.tend`,
`.tend/plan.json`, `~/.tend/state.json`. The lint counts come from actually
parsing the schema files. The plan is a real diff against deployed state.

Mocked: there is no remote planner. `push`/`deploy` mutate local state only.
Run tails stream canned events on a realistic clock.
