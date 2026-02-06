import { Notice, Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type { CollectionManager } from '../collections/manager';

class CreateCollectionModal extends Modal {
  result: { name: string; path: string; glob: string } | null = null;
  onSubmit: (result: { name: string; path: string; glob: string }) => void;

  constructor(app: App, onSubmit: (result: { name: string; path: string; glob: string }) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Create Collection' });

    let name = '';
    let path = '';
    let glob = '**/*.md';

    new Setting(contentEl)
      .setName('Collection name')
      .setDesc('Kebab-case name (e.g., my-notes)')
      .addText(text => text
        .setPlaceholder('my-collection')
        .onChange(value => { name = value; }));

    new Setting(contentEl)
      .setName('Vault path')
      .setDesc('Path relative to vault root')
      .addText(text => text
        .setPlaceholder('folder/subfolder')
        .onChange(value => { path = value; }));

    new Setting(contentEl)
      .setName('Glob pattern')
      .setDesc('File pattern to match')
      .addText(text => text
        .setValue('**/*.md')
        .onChange(value => { glob = value; }));

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Create')
        .setCta()
        .onClick(() => {
          if (!name || !path) {
            new Notice('Name and path are required');
            return;
          }
          this.close();
          this.onSubmit({ name, path, glob });
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => { this.close(); }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export function registerCollectionCommands(
  app: App,
  collectionManager: CollectionManager,
  addCommand: (config: any) => void
): void {

  addCommand({
    id: 'create-collection',
    name: 'Create collection',
    callback: () => {
      new CreateCollectionModal(app, async (result) => {
        try {
          await collectionManager.addCollection(result.name, result.path, result.glob);
          new Notice(`Collection "${result.name}" created`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          new Notice(`Failed to create collection: ${message}`);
          console.error('Create collection failed:', error);
        }
      }).open();
    }
  });

  addCommand({
    id: 'list-collections',
    name: 'List collections',
    callback: async () => {
      try {
        const collections = await collectionManager.listCollections();
        if (collections.length === 0) {
          new Notice('No collections found');
          return;
        }
        
        const names = collections.map(c => `- ${c.name} (${c.path})`).join('\n');
        new Notice(`Collections:\n${names}`, 8000);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        new Notice(`Failed to list collections: ${message}`);
        console.error('List collections failed:', error);
      }
    }
  });

  addCommand({
    id: 'delete-collection',
    name: 'Delete collection',
    callback: async () => {
      new Notice('Collection deletion modal not yet implemented');
    }
  });
}
