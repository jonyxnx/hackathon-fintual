# Jonathan Guevara — Platanus Build Night — Ciudad de México Project

**Current project logo:** project-logo.png

<img src="./project-logo.png" alt="Project Logo" width="200" />

Hacker:

- Jonathan Guevara ([@jonyxnx](https://github.com/jonyxnx))

Before submitting:

- ✅ Set a project name, oneliner and description in build-night-project.json
- ✅ Provide a 1000x1000 png project logo, max 500kb (project-logo.png)
- ✅ Provide a concise and to the point readme

## ⚠️ Deploying (Vercel, Render, etc.)

Deploy platforms like **Vercel**, **Render** or **Netlify** can only connect to
repositories **you own** — they can't be granted access to this organization repo.
To deploy while keeping your commits here, mirror your code to a personal repo:

1. Create a **personal** repository on your own GitHub account.
2. Point your local `origin` at **both** repos, so a single `git push` updates each one:

   ```bash
   # this org repo (keep it as a push target)...
   git remote set-url --add --push origin https://github.com/platanus-build-night/platanus-build-night-26-mx-jonyxnx.git
   # ...and your personal repo
   git remote set-url --add --push origin https://github.com/<your-user>/<your-repo>.git
   ```

   From now on `git push` sends every commit to **both** repositories.
3. Connect your deploy service (Vercel, Render, …) to your **personal** repo and deploy from there.

Your commits stay mirrored here for judging, while the deploy runs from the repo you control.

Have fun! 🚀

## Kitdoc Notion Docs

This repo includes a reusable GitHub Action that documents a repository and syncs generated markdown to Notion as a nested, developer-facing documentation tree built by an LLM.

For each run it creates a repo page and, beneath it, a page-in-page hierarchy that mirrors the codebase:

- One doc per folder, but only for folders substantial enough to warrant it (a usage-based emoji icon is set per folder). Small folders are folded into their nearest documented parent's doc.
- Large or multi-concern folders get a deeper doc that breaks the folder down by concern.
- A root `AGENTS.md` that acts as the documentation index and coverage report: it lists which folders were documented, which were folded in, and recommends what is still missing or should be expanded.

Pull-request runs document the changed top-level folders; the self-doc workflow uses `document-all: "true"` to document the entire repository.

Required repository secrets:

- `NOTION_TOKEN`: Notion integration token with access to the parent page.
- `NOTION_PAGE_ID`: Notion page ID where repo and folder pages should be created.
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`: LLM key for the selected provider.

Optional repository variable:

- `LLM_PROVIDER`: `anthropic` or `openai`; defaults to `anthropic` in the sample workflow.

Another repository can use the action with a PR-to-main workflow like this:

```yaml
name: Kitdoc Docs

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read
  pull-requests: read

jobs:
  notion-docs:
    runs-on: ubuntu-latest
    steps:
      - name: Generate Notion docs
        uses: OWNER/kitdoc/.github/actions/kitdoc-docs@main
        with:
          target-repository: ${{ github.event.pull_request.head.repo.full_name }}
          target-ref: ${{ github.event.pull_request.head.sha }}
          base-sha: ${{ github.event.pull_request.base.sha }}
          head-sha: ${{ github.event.pull_request.head.sha }}
          repo-owner: ${{ github.repository_owner }}
          repo-name: ${{ github.event.repository.name }}
          kitdoc-repository: OWNER/kitdoc
          kitdoc-ref: main
          notion-token: ${{ secrets.NOTION_TOKEN }}
          notion-page-id: ${{ secrets.NOTION_PAGE_ID }}
          llm-provider: ${{ vars.LLM_PROVIDER || 'anthropic' }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

The action checks out the target repository with full git history, checks out the kitdoc repository separately, runs `npm ci` for kitdoc, and runs the CLI against the target checkout. It documents each significant folder as a nested page, then generates the root `AGENTS.md` index + coverage report last so it can reflect everything that was produced. The folder-significance threshold is controlled by `--min-folder-files` (default 3).
