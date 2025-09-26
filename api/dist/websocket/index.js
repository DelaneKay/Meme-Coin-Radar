"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWebSocket = setupWebSocket;
const ws_1 = require("ws");
const logger_1 = require("../utils/logger");
function setupWebSocket(wss, orchestrator) {
    const clients = new Map();
    let clientIdCounter = 0;
    const heartbeatInterval = setInterval(() => {
        const now = Date.now();
        clients.forEach((client, id) => {
            if (client.ws.readyState === ws_1.WebSocket.OPEN) {
                if (now - client.lastPing > 60000) {
                    logger_1.logger.debug(`Client ${id} ping timeout, closing connection`);
                    client.ws.terminate();
                    clients.delete(id);
                    return;
                }
                client.ws.ping();
            }
            else {
                clients.delete(id);
            }
        });
    }, 30000);
    const unsubscribeHotlist = orchestrator.subscribeToHotlist((tokens) => {
        broadcastToSubscribers('hotlist', {
            type: 'hotlist',
            data: tokens,
            timestamp: Date.now(),
        });
    });
    const unsubscribeListings = orchestrator.subscribeToListings((event) => {
        broadcastToSubscribers('listings', {
            type: 'listing',
            data: event,
            timestamp: Date.now(),
        });
    });
    wss.on('connection', (ws, request) => {
        const clientId = `client_${++clientIdCounter}`;
        const client = {
            ws,
            id: clientId,
            subscriptions: new Set(),
            lastPing: Date.now(),
        };
        clients.set(clientId, client);
        logger_1.logger.info(`WebSocket client connected: ${clientId}`, {
            origin: request.headers.origin,
            userAgent: request.headers['user-agent'],
        });
        sendMessage(ws, {
            type: 'connection',
            data: {
                clientId,
                message: 'Connected to Meme Coin Radar WebSocket',
                availableTopics: ['hotlist', 'listings', 'health'],
            },
            timestamp: Date.now(),
        });
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                await handleClientMessage(client, message);
            }
            catch (error) {
                logger_1.logger.error(`Invalid WebSocket message from ${clientId}:`, error);
                sendError(ws, 'Invalid message format');
            }
        });
        ws.on('pong', () => {
            client.lastPing = Date.now();
        });
        ws.on('close', (code, reason) => {
            logger_1.logger.info(`WebSocket client disconnected: ${clientId}`, {
                code,
                reason: reason.toString(),
            });
            clients.delete(clientId);
        });
        ws.on('error', (error) => {
            logger_1.logger.error(`WebSocket error for client ${clientId}:`, error);
            clients.delete(clientId);
        });
    });
    wss.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribeHotlist();
        unsubscribeListings();
        logger_1.logger.info('WebSocket server closed');
    });
    async function handleClientMessage(client, message) {
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
    async function handleSubscribe(client, data) {
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
        client.subscriptions.add(topic);
        sendMessage(client.ws, {
            type: 'subscribed',
            data: { topic },
            timestamp: Date.now(),
        });
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
        logger_1.logger.debug(`Client ${client.id} subscribed to ${topic}`);
    }
    async function handleUnsubscribe(client, data) {
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
        logger_1.logger.debug(`Client ${client.id} unsubscribed from ${topic}`);
    }
    async function handleGetHotlist(client) {
        try {
            const hotlist = await orchestrator.getHotlist();
            sendMessage(client.ws, {
                type: 'hotlist',
                data: hotlist,
                timestamp: Date.now(),
            });
        }
        catch (error) {
            sendError(client.ws, 'Failed to fetch hotlist');
        }
    }
    async function handleGetLeaderboards(client) {
        try {
            const leaderboards = await orchestrator.getLeaderboards();
            sendMessage(client.ws, {
                type: 'leaderboards',
                data: leaderboards,
                timestamp: Date.now(),
            });
        }
        catch (error) {
            sendError(client.ws, 'Failed to fetch leaderboards');
        }
    }
    async function handleGetHealth(client) {
        try {
            const health = await orchestrator.getHealthStatus();
            sendMessage(client.ws, {
                type: 'health',
                data: health,
                timestamp: Date.now(),
            });
        }
        catch (error) {
            sendError(client.ws, 'Failed to fetch health status');
        }
    }
    function sendMessage(ws, message) {
        if (ws.readyState === ws_1.WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
            }
            catch (error) {
                logger_1.logger.error('Failed to send WebSocket message:', error);
            }
        }
    }
    function sendError(ws, error) {
        sendMessage(ws, {
            type: 'error',
            data: { error },
            timestamp: Date.now(),
        });
    }
    function broadcastToSubscribers(topic, message) {
        let sentCount = 0;
        clients.forEach((client) => {
            if (client.subscriptions.has(topic) && client.ws.readyState === ws_1.WebSocket.OPEN) {
                sendMessage(client.ws, message);
                sentCount++;
            }
        });
        if (sentCount > 0) {
            logger_1.logger.debug(`Broadcasted ${topic} update to ${sentCount} clients`);
        }
    }
    setInterval(async () => {
        try {
            const health = await orchestrator.getHealthStatus();
            broadcastToSubscribers('health', {
                type: 'health',
                data: health,
                timestamp: Date.now(),
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to broadcast health update:', error);
        }
    }, 60000);
    logger_1.logger.info('WebSocket server configured');
    logger_1.logger.info(`WebSocket available topics: hotlist, listings, health`);
}
//# sourceMappingURL=index.js.map