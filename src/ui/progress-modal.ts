import { Modal, App } from 'obsidian';

export interface ProgressState {
  current: number;
  total: number;
  message: string;
  canCancel: boolean;
}

export class ProgressModal extends Modal {
  private state: ProgressState;
  private progressBarEl: HTMLElement | null = null;
  private progressTextEl: HTMLElement | null = null;
  private messageEl: HTMLElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private onCancel: (() => void) | null = null;

  constructor(app: App, initialMessage: string = 'Processing...', canCancel: boolean = true) {
    super(app);
    this.state = {
      current: 0,
      total: 100,
      message: initialMessage,
      canCancel
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('qmd-progress-modal');

    this.messageEl = contentEl.createDiv({ cls: 'qmd-progress-message' });
    this.messageEl.textContent = this.state.message;

    const progressContainer = contentEl.createDiv({ cls: 'qmd-progress-container' });
    
    const progressTrack = progressContainer.createDiv({ cls: 'qmd-progress-track' });
    this.progressBarEl = progressTrack.createDiv({ cls: 'qmd-progress-bar' });
    
    this.progressTextEl = progressContainer.createDiv({ cls: 'qmd-progress-text' });
    this.updateProgressText();

    if (this.state.canCancel) {
      const buttonContainer = contentEl.createDiv({ cls: 'qmd-progress-actions' });
      this.cancelButton = buttonContainer.createEl('button', {
        text: 'Cancel',
        cls: 'qmd-progress-cancel'
      });
      this.cancelButton.addEventListener('click', () => this.handleCancel());
    }

    this.updateProgress();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  setProgress(current: number, total: number, message?: string): void {
    this.state.current = current;
    this.state.total = total;
    if (message) {
      this.state.message = message;
    }
    this.updateProgress();
  }

  setMessage(message: string): void {
    this.state.message = message;
    if (this.messageEl) {
      this.messageEl.textContent = message;
    }
  }

  setCancelable(canCancel: boolean): void {
    this.state.canCancel = canCancel;
    if (this.cancelButton) {
      this.cancelButton.style.display = canCancel ? 'block' : 'none';
    }
  }

  onCancelCallback(callback: () => void): void {
    this.onCancel = callback;
  }

  private updateProgress(): void {
    const percent = this.state.total > 0
      ? Math.min(100, Math.max(0, (this.state.current / this.state.total) * 100))
      : 0;

    if (this.progressBarEl) {
      this.progressBarEl.style.width = `${percent}%`;
    }

    this.updateProgressText();

    if (this.messageEl) {
      this.messageEl.textContent = this.state.message;
    }
  }

  private updateProgressText(): void {
    if (!this.progressTextEl) return;
    
    const percent = this.state.total > 0
      ? Math.round((this.state.current / this.state.total) * 100)
      : 0;
    
    this.progressTextEl.textContent = `${this.state.current} / ${this.state.total} (${percent}%)`;
  }

  private handleCancel(): void {
    if (this.onCancel) {
      this.onCancel();
    }
    this.close();
  }

  complete(message: string = 'Complete!'): void {
    this.setProgress(this.state.total, this.state.total, message);
    setTimeout(() => {
      this.close();
    }, 1000);
  }
}
