'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import useWebSocketLib, { ReadyState } from 'react-use-websocket';
import { toast } from 'react-hot-toast';
import { WSMessage, TokenSummary, CEXListingEvent } from '@shared/types';

interface UseWebSocketReturn {
  isConnected: boolean;
  connectionStatus: string;
  hotlist: TokenSummary[];
  lastCEXListing: CEXListingEvent | null;
  subscribe: (topic: string) => void;
  unsubscribe: (topic: string) => void;
  sendMessage: (message: any) => void;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

export function useWebSocket(): UseWebSocketReturn {
  const [hotlist, setHotlist] = useState<TokenSummary[]>([]);
  const [lastCEXListing, setLastCEXListing] = useState<CEXListingEvent | null>(null);
  const [subscriptions, setSubscriptions] = useState<Set<string>>(new Set());
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const {
    sendMessage: sendWsMessage,
    lastMessage,
    readyState,
    getWebSocket,
  } = useWebSocketLib(WS_URL, {
    onOpen: () => {
      console.log('WebSocket connected');
      reconnectAttempts.current = 0;
      toast.success('Connected to real-time updates');
      
      // Re-subscribe to previous topics
      subscriptions.forEach(topic => {
        sendWsMessage(JSON.stringify({
          type: 'subscribe',
          data: { topic },
        }));
      });
    },
    onClose: () => {
      console.log('WebSocket disconnected');
      toast.error('Disconnected from real-time updates');
    },
    onError: (event) => {
      console.error('WebSocket error:', event);
      toast.error('Connection error occurred');
    },
    shouldReconnect: (closeEvent) => {
      // Reconnect unless it was a manual close
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        return true;
      }
      return false;
    },
    reconnectInterval: (attemptNumber) => {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      return Math.min(1000 * Math.pow(2, attemptNumber), 16000);
    },
    reconnectAttempts: maxReconnectAttempts,
  });

  // Handle incoming messages
  useEffect(() => {
    if (lastMessage !== null) {
      try {
        const message: WSMessage = JSON.parse(lastMessage.data);
        handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    }
  }, [lastMessage]);

  const handleMessage = useCallback((message: WSMessage) => {
    switch (message.type) {
      case 'connection':
        console.log('WebSocket connection established:', message.data);
        break;

      case 'hotlist':
        setHotlist(message.data);
        break;

      case 'listing':
        const listingEvent = message.data as CEXListingEvent;
        setLastCEXListing(listingEvent);
        
        // Show notification for new CEX listing
        toast.success(
          `🚀 CEX Listing Alert: ${listingEvent.token.symbol} on ${listingEvent.exchange}`,
          {
            duration: 8000,
            style: {
              background: '#22c55e',
              color: 'white',
            },
          }
        );
        break;

      case 'health':
        // Handle health status updates
        console.log('Health status:', message.data);
        break;

      case 'subscribed':
        console.log('Subscribed to:', message.data.topic);
        break;

      case 'unsubscribed':
        console.log('Unsubscribed from:', message.data.topic);
        break;

      case 'error':
        console.error('WebSocket error:', message.data.error);
        toast.error(`WebSocket error: ${message.data.error}`);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }, []);

  const subscribe = useCallback((topic: string) => {
    if (readyState === ReadyState.OPEN) {
      sendWsMessage(JSON.stringify({
        type: 'subscribe',
        data: { topic },
      }));
      setSubscriptions(prev => new Set([...prev, topic]));
    }
  }, [readyState, sendWsMessage]);

  const unsubscribe = useCallback((topic: string) => {
    if (readyState === ReadyState.OPEN) {
      sendWsMessage(JSON.stringify({
        type: 'unsubscribe',
        data: { topic },
      }));
      setSubscriptions(prev => {
        const newSet = new Set(prev);
        newSet.delete(topic);
        return newSet;
      });
    }
  }, [readyState, sendWsMessage]);

  const sendMessage = useCallback((message: any) => {
    if (readyState === ReadyState.OPEN) {
      sendWsMessage(JSON.stringify(message));
    }
  }, [readyState, sendWsMessage]);

  // Auto-subscribe to hotlist and listings on connection
  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      subscribe('hotlist');
      subscribe('listings');
    }
  }, [readyState, subscribe]);

  const getConnectionStatus = () => {
    switch (readyState) {
      case ReadyState.CONNECTING:
        return 'Connecting...';
      case ReadyState.OPEN:
        return 'Connected';
      case ReadyState.CLOSING:
        return 'Disconnecting...';
      case ReadyState.CLOSED:
        return reconnectAttempts.current > 0 ? 'Reconnecting...' : 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  return {
    isConnected: readyState === ReadyState.OPEN,
    connectionStatus: getConnectionStatus(),
    hotlist,
    lastCEXListing,
    subscribe,
    unsubscribe,
    sendMessage,
  };
}