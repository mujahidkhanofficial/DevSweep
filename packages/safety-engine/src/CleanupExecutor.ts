import { SafetyEngine } from './SafetyEngine.js';
import { PauseController } from './PauseController.js';
import { CleanupTransaction } from '../../shared/src/rules.types.js';
import { CleanupProgressEvent } from '../../shared/src/disk.types.js';
import { CleanupManager, CleanupManagerOptions } from './CleanupManager.js';

export type CleanupExecutionOptions = CleanupManagerOptions;

export class CleanupExecutor {
  private manager: CleanupManager;

  constructor(
    private safetyEngine: SafetyEngine,
    private ruleRegistry?: { getRule: (id: string) => any }
  ) {
    this.manager = new CleanupManager(safetyEngine, ruleRegistry);
  }

  public async execute(options: CleanupExecutionOptions): Promise<CleanupTransaction> {
    return this.manager.execute(options);
  }
}
