# kitdoc

<img src="./project-logo.png" alt="kitdoc logo" width="180" />

Concise developer docs from any GitHub repository.

kitdoc reads a GitHub repo and generates:

- short developer-facing docs,
- a readable file map,
- important folder docs,
- an `AGENTS.md` guide for coding agents,
- downloadable markdown ready for Notion.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and paste a public GitHub repository URL.

## Environment

Use one LLM provider:

```bash
OPENAI_API_KEY=...
# or
ANTHROPIC_API_KEY=...
```

Optional:

```bash
GITHUB_TOKEN=...
```

## CLI

```bash
npm run kitdoc -- --dir . --all --provider openai --depth 5 --dry-run
```

Depth controls detail:

- `1`: rough idea
- `5`: important things
- `10`: detailed scan

## Build Night

Built by Jonathan Guevara ([@jonyxnx](https://github.com/jonyxnx)) at Platanus Build Night Ciudad de Mexico.
