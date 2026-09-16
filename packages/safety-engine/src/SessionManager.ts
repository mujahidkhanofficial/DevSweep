import { ScannedItem } from '../../shared/src/rules.types.js';

export interface ScanSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  items: Map<string, ScannedItem>;
  isCancelled: boolean;
}

export class SessionManager {
  private sessions: Map<string, ScanSession> = new Map();
  private static readonly DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

  public createSession(): ScanSession {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const randomHex = Math.random().toString(16).slice(2, 8);
    const id = `SCAN-${timestamp}-${randomHex}`;

    const now = Date.now();
    const session: ScanSession = {
      id,
      createdAt: now,
      expiresAt: now + SessionManager.DEFAULT_TTL_MS,
      items: new Map(),
      isCancelled: false
    };

    this.sessions.set(id, session);
    return session;
  }

  public getSession(sessionId: string): ScanSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  public registerItem(sessionId: string, item: ScannedItem): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    session.items.set(item.id, item);
    return true;
  }

  public getItem(sessionId: string, itemId: string): ScannedItem | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    return session.items.get(itemId) || null;
  }

  public cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.isCancelled = true;
    return true;
  }

  public invalidate(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
