export class PauseController {
  private _isPaused = false;
  private _resumePromise: Promise<void> | null = null;
  private _resolveResume: (() => void) | null = null;

  public get isPaused(): boolean {
    return this._isPaused;
  }

  public pause(): void {
    if (this._isPaused) return;
    this._isPaused = true;
    this._resumePromise = new Promise((resolve) => {
      this._resolveResume = resolve;
    });
  }

  public resume(): void {
    if (!this._isPaused) return;
    this._isPaused = false;
    if (this._resolveResume) {
      this._resolveResume();
      this._resolveResume = null;
      this._resumePromise = null;
    }
  }

  public async waitIfPaused(): Promise<void> {
    if (this._isPaused && this._resumePromise) {
      await this._resumePromise;
    }
  }
}
