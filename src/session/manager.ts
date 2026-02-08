import type { Session, ConversationMessage } from '../types/index.js';
import logger from '../utils/logger.js';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  getSession(userId: string): Session {
    let session = this.sessions.get(userId);

    if (!session) {
      logger.info(`Creating new session for user: ${userId}`);
      session = {
        userId,
        conversationHistory: [],
        activeServers: new Set(),
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.sessions.set(userId, session);
    } else {
      session.lastActivity = Date.now();
    }

    return session;
  }

  addMessage(userId: string, message: ConversationMessage): void {
    const session = this.getSession(userId);
    session.conversationHistory.push(message);

    // Keep only last 20 messages to manage context window
    if (session.conversationHistory.length > 20) {
      session.conversationHistory = session.conversationHistory.slice(-20);
    }
  }

  clearHistory(userId: string): void {
    const session = this.getSession(userId);
    session.conversationHistory = [];
    logger.info(`Cleared conversation history for user: ${userId}`);
  }

  addActiveServer(userId: string, serverId: string): void {
    const session = this.getSession(userId);
    session.activeServers.add(serverId);
  }

  removeActiveServer(userId: string, serverId: string): void {
    const session = this.getSession(userId);
    session.activeServers.delete(serverId);
  }

  getActiveServers(userId: string): string[] {
    const session = this.getSession(userId);
    return Array.from(session.activeServers);
  }

  deleteSession(userId: string): void {
    this.sessions.delete(userId);
    logger.info(`Deleted session for user: ${userId}`);
  }

  // Cleanup inactive sessions
  cleanupInactiveSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.SESSION_TIMEOUT) {
        this.sessions.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} inactive sessions`);
    }
  }

  // Start periodic cleanup
  startCleanup(): void {
    setInterval(() => {
      this.cleanupInactiveSessions();
    }, 5 * 60 * 1000); // Run every 5 minutes
  }
}
