import { Client } from "@notionhq/client";
import type {
  AppendBlockChildrenParameters,
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { markdownToBlocks } from "@tryfabric/martian";

const NOTION_BLOCK_BATCH_SIZE = 100;

type NotionBlock = AppendBlockChildrenParameters["children"][number];
type ListedBlock = BlockObjectResponse | PartialBlockObjectResponse;
type ChildPageBlock = BlockObjectResponse & { type: "child_page" };

export interface NotionDocsOptions {
  auth: string;
}

export interface NotionPageRef {
  id: string;
  title: string;
  created: boolean;
}

function emojiIcon(emoji?: string): { type: "emoji"; emoji: string } | undefined {
  return emoji ? { type: "emoji", emoji: emoji as never } : undefined;
}

export class NotionDocs {
  private readonly notion: Client;

  constructor(opts: NotionDocsOptions) {
    this.notion = new Client({ auth: opts.auth });
  }

  async ensureRepoPage(parentPageId: string, title: string, icon?: string): Promise<NotionPageRef> {
    return this.ensureChildPage(parentPageId, title, icon);
  }

  async upsertFolderPage(
    repoPageId: string,
    folderTitle: string,
    markdown: string,
    icon?: string,
  ): Promise<NotionPageRef> {
    return this.upsertMarkdownPage(repoPageId, folderTitle, markdown, icon);
  }

  async upsertMarkdownPage(
    parentPageId: string,
    title: string,
    markdown: string,
    icon?: string,
  ): Promise<NotionPageRef> {
    const page = await this.ensureChildPage(parentPageId, title, icon);
    // Preserve nested child pages so re-running keeps the documentation tree;
    // only the prose content of this page is refreshed.
    await this.clearContentBlocks(page.id);
    await this.appendMarkdown(page.id, markdown);
    return page;
  }

  /**
   * Ensure a child page exists (creating it if needed) and set its icon, without
   * touching its content. Callers can create nested subpages before writing the
   * parent's prose so subpages render above the text instead of at the bottom.
   */
  async ensurePage(parentPageId: string, title: string, icon?: string): Promise<NotionPageRef> {
    return this.ensureChildPage(parentPageId, title, icon);
  }

  /**
   * Refresh a page's prose: delete existing content blocks (keeping nested child
   * pages) and append the markdown. Because the markdown is appended after the
   * preserved child pages, subpages stay at the top of the page.
   */
  async writeMarkdown(pageId: string, markdown: string): Promise<void> {
    await this.clearContentBlocks(pageId);
    await this.appendMarkdown(pageId, markdown);
  }

  markdownToNotionBlocks(markdown: string): NotionBlock[] {
    return markdownToBlocks(markdown) as NotionBlock[];
  }

  /** True if a child page with the given title already exists under the parent. */
  async childPageExists(parentPageId: string, title: string): Promise<boolean> {
    return (await this.findChildPage(parentPageId, title)) !== null;
  }

  private async ensureChildPage(
    parentPageId: string,
    title: string,
    icon?: string,
  ): Promise<NotionPageRef> {
    const existing = await this.findChildPage(parentPageId, title);
    if (existing) {
      if (icon) {
        await this.notion.pages.update({ page_id: existing.id, icon: emojiIcon(icon) });
      }
      return { id: existing.id, title, created: false };
    }

    const created = await this.notion.pages.create({
      parent: { page_id: parentPageId },
      icon: emojiIcon(icon),
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
    });

    return { id: created.id, title, created: true };
  }

  private async findChildPage(parentPageId: string, title: string): Promise<{ id: string } | null> {
    for await (const block of this.listBlockChildren(parentPageId)) {
      if (!this.isChildPageBlock(block)) continue;
      if (block.child_page.title === title) {
        return { id: block.id };
      }
    }

    return null;
  }

  /** Delete this page's content blocks but keep nested child pages intact. */
  private async clearContentBlocks(blockId: string): Promise<void> {
    const children: ListedBlock[] = [];
    for await (const block of this.listBlockChildren(blockId)) {
      children.push(block);
    }

    for (const block of children) {
      if (this.isChildPageBlock(block)) continue;
      await this.notion.blocks.delete({ block_id: block.id });
    }
  }

  private async appendMarkdown(blockId: string, markdown: string): Promise<void> {
    const blocks = this.markdownToNotionBlocks(markdown);
    for (let i = 0; i < blocks.length; i += NOTION_BLOCK_BATCH_SIZE) {
      await this.notion.blocks.children.append({
        block_id: blockId,
        children: blocks.slice(i, i + NOTION_BLOCK_BATCH_SIZE),
      });
    }
  }

  private async *listBlockChildren(blockId: string): AsyncGenerator<ListedBlock> {
    let startCursor: string | undefined;

    do {
      const response = await this.notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: startCursor,
      });

      yield* response.results;
      startCursor = response.next_cursor ?? undefined;
    } while (startCursor);
  }

  private isChildPageBlock(block: ListedBlock): block is ChildPageBlock {
    return "type" in block && block.type === "child_page";
  }
}

export function createNotionDocsFromEnv(): { notion: NotionDocs; parentPageId: string } {
  const auth = process.env.NOTION_TOKEN;
  const parentPageId = process.env.NOTION_PAGE_ID;

  if (!auth) {
    throw new Error("NOTION_TOKEN is required unless --dry-run is set.");
  }

  if (!parentPageId) {
    throw new Error("NOTION_PAGE_ID is required unless --dry-run is set.");
  }

  return { notion: new NotionDocs({ auth }), parentPageId };
}
