import { Plugin, Notice, Menu, TFile } from 'obsidian';
import { QMDSettingsTab, DEFAULT_SETTINGS, type QMDSettings } from './src/ui/settings-tab';
import { initDatabase, loadDatabase, serializeDatabase, type Database } from './src/database';
import { CollectionManager } from './src/collections/manager';
import { DocumentIndexer } from './src/database/indexer';
import { OllamaEmbedder } from './src/embeddings/embedder';
import { QMDStatusView, STATUS_VIEW_TYPE } from './src/ui/status-view';
import { QMDSearchModal } from './src/ui/search-modal';
import { HybridSearcher } from './src/search/hybrid-search';
import { registerIndexCommands } from './src/commands/index-commands';
import { registerCollectionCommands } from './src/commands/collection-commands';
import { registerMaintenanceCommands } from './src/commands/maintenance-commands';
import { registerRetrievalCommands } from './src/commands/retrieval-commands';

export default class QMDPlugin extends Plugin {
	settings: QMDSettings = DEFAULT_SETTINGS;
	db: Database | null = null;
	collectionManager: CollectionManager | null = null;
	indexer: DocumentIndexer | null = null;
	embedder: OllamaEmbedder | null = null;
	hybridSearcher: HybridSearcher | null = null;
	statusView: QMDStatusView | null = null;
	fileWatcherTimeout: NodeJS.Timeout | null = null;

	async onload() {
		console.log('Loading QMD Search plugin');
		
		await this.loadSettings();
		await this.initializeDatabase();
		await this.initializeServices();
		
		this.registerView(
			STATUS_VIEW_TYPE,
			(leaf) => {
				this.statusView = new QMDStatusView(leaf);
				if (this.db) {
					this.statusView.setDatabase(this.db);
				}
				return this.statusView;
			}
		);

		this.addCommand({
			id: 'open-qmd-search',
			name: 'Open Search',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'f' }],
			callback: () => {
				if (!this.db || !this.embedder) {
					new Notice('QMD Search not initialized');
					return;
				}
				new QMDSearchModal(this.app, this.db, this.embedder).open();
			}
		});

		if (this.indexer) {
			registerIndexCommands(this.app, this.indexer, this.addCommand.bind(this));
		}

		if (this.collectionManager) {
			registerCollectionCommands(this.app, this.collectionManager, this.addCommand.bind(this));
		}

		if (this.db && this.indexer) {
			registerMaintenanceCommands(this.indexer, this.db, this.addCommand.bind(this));
		}

		if (this.indexer && this.hybridSearcher) {
			registerRetrievalCommands(this.app, this.indexer, this.hybridSearcher, this.addCommand.bind(this));
		}

		if (this.settings.autoIndex && this.indexer) {
			this.registerFileWatcher();
		}

		this.registerContextMenus();

		this.addSettingTab(new QMDSettingsTab(this.app, this));
	}

	async onunload() {
		console.log('Unloading QMD Search plugin');
		
		if (this.db) {
			await this.saveDatabase();
			this.db.close();
		}
	}

	async initializeDatabase() {
		try {
			const savedData = await this.loadData();
			
			if (savedData?.dbData) {
				const uint8Array = new Uint8Array(savedData.dbData);
				this.db = await loadDatabase(uint8Array, {
					enableVectorSearch: false
				});
				console.log('Database loaded from storage');
			} else {
				this.db = await initDatabase({
					enableVectorSearch: false
				});
				console.log('New database initialized');
			}
		} catch (error) {
			console.error('Database initialization failed:', error);
			new Notice('Failed to initialize database');
			throw error;
		}
	}

	async initializeServices() {
		if (!this.db) {
			throw new Error('Database not initialized');
		}

		this.collectionManager = new CollectionManager(this.db, this.app.vault);
		this.indexer = new DocumentIndexer(this.db, this.app.vault, this.collectionManager);
		this.embedder = new OllamaEmbedder({
			baseUrl: this.settings.ollamaBaseUrl,
			model: this.settings.embeddingModel,
			expectedDimensions: this.settings.embeddingDimensions
		});
		this.hybridSearcher = new HybridSearcher(this.db, this.embedder);

		const ollamaStatus = await this.embedder.testConnection();
		if (this.statusView) {
			this.statusView.updateOllamaStatus(ollamaStatus.connected, ollamaStatus.error || null);
		}
	}

	async saveDatabase() {
		if (!this.db) return;

		try {
			const dbData = serializeDatabase(this.db);
			const savedData = await this.loadData() || {};
			savedData.dbData = Array.from(dbData);
			await this.saveData(savedData);
		} catch (error) {
			console.error('Failed to save database:', error);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	registerFileWatcher() {
		if (!this.indexer) return;

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.debouncedIndexFile(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.debouncedIndexFile(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.extension === 'md' && this.indexer) {
					this.indexer.removeDocument(file.path).catch(error => {
						console.error('Failed to remove document:', error);
					});
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md' && this.indexer) {
					this.indexer.renameDocument(oldPath, file.path).catch(error => {
						console.error('Failed to rename document:', error);
					});
				}
			})
		);
	}

	debouncedIndexFile(path: string) {
		if (this.fileWatcherTimeout) {
			clearTimeout(this.fileWatcherTimeout);
		}

		this.fileWatcherTimeout = setTimeout(async () => {
			if (!this.indexer) return;

			try {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file && file.hasOwnProperty('extension')) {
					await this.indexer.updateDocument(file as any);
					console.log(`Indexed: ${path}`);
				}
			} catch (error) {
				console.error(`Failed to index ${path}:`, error);
			}
		}, this.settings.indexDebounceMs);
	}

	registerContextMenus() {
		this.registerEvent(
			this.app.workspace.on('file-menu' as any, (menu: Menu, file: TFile) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;

				menu.addItem((item) => {
					item
						.setTitle('Reindex this file')
						.setIcon('refresh-cw')
						.onClick(async () => {
							if (!this.indexer) {
								new Notice('Indexer not initialized');
								return;
							}

							try {
								await this.indexer.updateDocument(file);
								new Notice(`Reindexed: ${file.name}`);
							} catch (error) {
								const message = error instanceof Error ? error.message : 'Unknown error';
								new Notice(`Failed to reindex: ${message}`);
								console.error('Reindex failed:', error);
							}
						});
				});

				menu.addItem((item) => {
					item
						.setTitle('Add to collection')
						.setIcon('folder-plus')
						.onClick(() => {
							new Notice('Add to collection not yet implemented');
						});
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-menu' as any, (menu: Menu) => {
				menu.addItem((item) => {
					item
						.setTitle('Search selection')
						.setIcon('search')
						.onClick(async () => {
							const editor = this.app.workspace.activeEditor?.editor;
							if (!editor) return;

							const selection = editor.getSelection();
							if (!selection) {
								new Notice('No text selected');
								return;
							}

							if (!this.db || !this.embedder) {
								new Notice('QMD Search not initialized');
								return;
							}

							new QMDSearchModal(this.app, this.db, this.embedder).open();
						});
				});
			})
		);
	}
}
