import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger';
import { Orchestrator } from '../services/orchestrator';
import { WSMessage, TokenSummary, CEXListingEvent } from '../types';
import { radarOnlyFilter } from '../middleware/radarOnly';

interface WSClient {
  ws: WebSocket;
  id: string;
  subscriptions: Set<string>;
  lastPing: number;
}

export function setupWebSocket(wss: WebSocketServer, orchestrator: Orchestrator): void {
  const clients = new Map<string, WSClient>();
  let clientIdCounter = 0;

  // Heartbeat interval to keep connections alive
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    
    clients.forEach((client, id) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        // Check if client responded to last ping
        if (now - client.lastPing > 60000) { // 60 seconds timeout
          logger.debug(`Client ${id} ping timeout, closing connection`);
          client.ws.terminate();
          clients.delete(id);
          return;
        }
        
        // Send ping
        client.ws.ping();
      } else {
        clients.delete(id);
      }
    });
  }, 30000); // Ping every 30 seconds

  // Subscribe to orchestrator events
  const unsubscribeHotlist = orchestrator.subscribeToHotlist((tokens: TokenSummary[]) => {
    broadcastToSubscribers('hotlist', {
      type: 'hotlist',
      data: tokens,
      timestamp: Date.now(),
    });
  });

  const unsubscribeListings = orchestrator.subscribeToListings((event: CEXListingEvent) => {
    broadcastToSubscribers('listings', {
      type: 'listing',
      data: event,
      timestamp: Date.now(),
    });
  });

  // Handle new WebSocket connections
  wss.on('connection', (ws: WebSocket, request) => {
    const clientId = `client_${++clientIdCounter}`;
    const client: WSClient = {
      ws,
      id: clientId,
      subscriptions: new Set(),
      lastPing: Date.now(),
    };
    
    clients.set(clientId, client);
    
    logger.info(`WebSocket client connected: ${clientId}`, {
      origin: request.headers.origin,
      userAgent: request.headers['user-agent'],
    });

    // Send welcome message
    sendMessage(ws, {
      type: 'connection',
      data: {
        clientId,
        message: 'Connected to Meme Coin Radar WebSocket',
        availableTopics: ['hotlist', 'listings', 'health'],
      },
      timestamp: Date.now(),
    });

    // Handle incoming messages
    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleClientMessage(client, message);
      } catch (error) {
        logger.error(`Invalid WebSocket message from ${clientId}:`, error);
        sendError(ws, 'Invalid message format');
      }
    });

    // Handle pong responses
    ws.on('pong', () => {
      client.lastPing = Date.now();
    });

    // Handle connection close
    ws.on('close', (code: number, reason: Buffer) => {
      logger.info(`WebSocket client disconnected: ${clientId}`, {
        code,
        reason: reason.toString(),
      });
      clients.delete(clientId);
    });

    // Handle connection errors
    ws.on('error', (error: Error) => {
      logger.error(`WebSocket error for client ${clientId}:`, error);
      clients.delete(clientId);
    });
  });

  // Handle server shutdown
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    unsubscribeHotlist();
    unsubscribeListings();
    logger.info('WebSocket server closed');
  });

  // =============================================================================
  // MESSAGE HANDLING
  // =============================================================================

  async function handleClientMessage(client: WSClient, message: any): Promise<void> {
    const { type, data } = message;

    switch (type) {
      case 'subscribe':
        await handleSubscribe(client, data);
        break;
        
      case 'unsubscribe':
        await handleUnsubscribe(client, data);
        break;
        
      case 'get_hotlist':
        await handleGetHotlist(client);
        break;
        
      case 'get_leaderboards':
        await handleGetLeaderboards(client);
        break;
        
      case 'get_health':
        await handleGetHealth(client);
        break;
        
      default:
        sendError(client.ws, `Unknown message type: ${type}`);
    }
  }

  async function handleSubscribe(client: WSClient, data: any): Promise<void> {
    const { topic } = data;
    
    if (!topic || typeof topic !== 'string') {
      sendError(client.ws, 'Invalid subscription topic');
      return;
    }

    const validTopics = ['hotlist', 'listings', 'health'];
    if (!validTopics.includes(topic)) {
      sendError(client.ws, `Invalid topic. Available topics: ${validTopics.join(', ')}`);
      return;
    }

    // Check radar-only restrictions
    if (!radarOnlyFilter.filterWebSocketTopic(topic)) {
      sendError(client.ws, `Topic '${topic}' not available in radar-only mode`);
      return;
    }

    client.subscriptions.add(topic);
    
    sendMessage(client.ws, {
      type: 'subscribed',
      data: { topic },
      timestamp: Date.now(),
    });

    // Send current data for the subscribed topic
    switch (topic) {
      case 'hotlist':
        const hotlist = await orchestrator.getHotlist();
        sendMessage(client.ws, {
          type: 'hotlist',
          data: hotlist,
          timestamp: Date.now(),
        });
        break;
        
      case 'health':
        const health = await orchestrator.getHealthStatus();
        sendMessage(client.ws, {
          type: 'health',
          data: health,
          timestamp: Date.now(),
        });
        break;
    }

    logger.debug(`Client ${client.id} subscribed to ${topic}`);
  }

  async function handleUnsubscribe(client: WSClient, data: any): Promise<void> {
    const { topic } = data;
    
    if (!topic || typeof topic !== 'string') {
      sendError(client.ws, 'Invalid unsubscription topic');
      return;
    }

    client.subscriptions.delete(topic);
    
    sendMessage(client.ws, {
      type: 'unsubscribed',
      data: { topic },
      timestamp: Date.now(),
    });

    logger.debug(`Client ${client.id} unsubscribed from ${topic}`);
  }

  async function handleGetHotlist(client: WSClient): Promise<void> {
    try {
      const hotlist = await orchestrator.getHotlist();
      sendMessage(client.ws, {
        type: 'hotlist',
        data: hotlist,
        timestamp: Date.now(),
      });
    } catch (error) {
      sendError(client.ws, 'Failed to fetch hotlist');
    }
  }

  async function handleGetLeaderboards(client: WSClient): Promise<void> {
    try {
      const leaderboards = await orchestrator.getLeaderboards();
      sendMessage(client.ws, {
        type: 'leaderboards',
        data: leaderboards,
        timestamp: Date.now(),
      });
    } catch (error) {
      sendError(client.ws, 'Failed to fetch leaderboards');
    }
  }

  async function handleGetHealth(client: WSClient): Promise<void> {
    try {
      const health = await orchestrator.getHealthStatus();
      sendMessage(client.ws, {
        type: 'health',
        data: health,
        timestamp: Date.now(),
      });
    } catch (error) {
      sendError(client.ws, 'Failed to fetch health status');
    }
  }

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  function sendMessage(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error('Failed to send WebSocket message:', error);
      }
    }
  }

  function sendError(ws: WebSocket, error: string): void {
    sendMessage(ws, {
      type: 'error',
      data: { error },
      timestamp: Date.now(),
    });
  }

  function broadcastToSubscribers(topic: string, message: WSMessage): void {
    let sentCount = 0;
    
    clients.forEach((client) => {
      if (client.subscriptions.has(topic) && client.ws.readyState === WebSocket.OPEN) {
        sendMessage(client.ws, message);
        sentCount++;
      }
    });

    if (sentCount > 0) {
      logger.debug(`Broadcasted ${topic} update to ${sentCount} clients`);
    }
  }

  // Periodic health updates for subscribed clients
  setInterval(async () => {
    try {
      const health = await orchestrator.getHealthStatus();
      broadcastToSubscribers('health', {
        type: 'health',
        data: health,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error('Failed to broadcast health update:', error);
    }
  }, 60000); // Every minute

  logger.info('WebSocket server configured');
  logger.info(`WebSocket available topics: hotlist, listings, health`);
}