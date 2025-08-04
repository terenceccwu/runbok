const url = require('url');
const NodeInspectorClient = require('./node-inspector');

class NodeInspectorConnectionPool {
    constructor() {
        this.connections = new Map(); // endpoint -> { client, lastUsed, connecting }
        this.connectionPromises = new Map(); // endpoint -> Promise (for concurrent connection attempts)
        this.cleanupInterval = 5 * 60 * 1000; // 5 minutes
        this.maxIdleTime = 10 * 60 * 1000; // 10 minutes
        
        // Start cleanup timer
        this.startCleanup();
    }

    parseEndpoint(endpoint) {
        try {
            if (!endpoint) {
                return { 
                    host: 'localhost', 
                    port: 9229, 
                    target: null,
                    webSocketUrl: null 
                };
            }

            // Handle WebSocket URL format: ws://host:port/target-id
            if (typeof endpoint === 'string' && (endpoint.startsWith('ws://') || endpoint.startsWith('wss://'))) {
                const parsed = url.parse(endpoint);
                const host = parsed.hostname || 'localhost';
                const port = parseInt(parsed.port) || 9222;
                const targetId = parsed.pathname ? (parsed.pathname.includes('/devtools/page/') ? parsed.pathname.split('/devtools/page/')[1] : parsed.pathname.substring(1)) : null; // Handle Chrome DevTools Targets and Remove leading '/'
                
                return {
                    host,
                    port,
                    target: targetId,
                    webSocketUrl: endpoint
                };
            }

            // Handle different endpoint formats
            if (typeof endpoint === 'string') {
                // Format: "host:port" or "localhost:9229"
                if (endpoint.includes(':')) {
                    const [host, port] = endpoint.split(':');
                    return { 
                        host: host || 'localhost', 
                        port: parseInt(port) || 9229,
                        target: null,
                        webSocketUrl: null
                    };
                }
                // Format: just port number
                if (/^\d+$/.test(endpoint)) {
                    return { 
                        host: 'localhost', 
                        port: parseInt(endpoint),
                        target: null,
                        webSocketUrl: null
                    };
                }
                // Format: just host
                return { 
                    host: endpoint, 
                    port: 9229,
                    target: null,
                    webSocketUrl: null
                };
            }

            // Format: object { host, port, target?, webSocketUrl? }
            if (typeof endpoint === 'object') {
                return {
                    host: endpoint.host || 'localhost',
                    port: endpoint.port || 9229,
                    target: endpoint.target || null,
                    webSocketUrl: endpoint.webSocketUrl || null
                };
            }

            throw new Error('Invalid endpoint format');
        } catch (error) {
            throw new Error(`Invalid endpoint "${endpoint}": ${error.message}`);
        }
    }

    getEndpointKey(endpoint) {
        const parsed = this.parseEndpoint(endpoint);
        
        // If we have a WebSocket URL with target, use that as the key
        if (parsed.webSocketUrl) {
            return parsed.webSocketUrl;
        }
        
        // If we have a specific target, include it in the key
        if (parsed.target) {
            return `${parsed.host}:${parsed.port}/${parsed.target}`;
        }
        
        // Default to host:port
        return `${parsed.host}:${parsed.port}`;
    }

    async getConnection(endpoint) {
        const key = this.getEndpointKey(endpoint);
        const existing = this.connections.get(key);

        // Check if we have a valid existing connection
        if (existing && existing.client && !existing.client.isDisconnected) {
            existing.lastUsed = Date.now();
            return existing.client;
        }

        // Check if we're already connecting to this endpoint
        if (this.connectionPromises.has(key)) {
            console.log(`Waiting for ongoing connection to ${key}`);
            return this.connectionPromises.get(key);
        }

        // Create new connection
        console.log(`Creating new connection to ${key}`);
        const connectionPromise = this.createConnection(endpoint, key);
        this.connectionPromises.set(key, connectionPromise);

        try {
            const client = await connectionPromise;
            this.connectionPromises.delete(key);
            return client;
        } catch (error) {
            this.connectionPromises.delete(key);
            throw error;
        }
    }

    async createConnection(endpoint, key) {
        const { host, port } = this.parseEndpoint(endpoint);
        
        try {
            const client = new NodeInspectorClient(host, port);
            
            // Add disconnection handler
            client.on('disconnect', () => {
                console.log(`Connection to ${key} was disconnected`);
                this.connections.delete(key);
            });

            // Add error handler
            client.on('error', (error) => {
                console.error(`Connection error for ${key}:`, error.message);
                this.connections.delete(key);
            });

            await client.connect();

            // Store the connection
            this.connections.set(key, {
                client,
                lastUsed: Date.now(),
                connecting: false
            });

            console.log(`Successfully connected to ${key}`);
            return client;

        } catch (error) {
            console.error(`Failed to connect to ${key}:`, error.message);
            this.connections.delete(key);
            throw new Error(`Failed to connect to ${endpoint}: ${error.message}`);
        }
    }

    async closeConnection(endpoint) {
        const key = this.getEndpointKey(endpoint);
        const connection = this.connections.get(key);
        
        if (connection && connection.client) {
            try {
                await connection.client.disconnect();
            } catch (error) {
                console.error(`Error closing connection to ${key}:`, error.message);
            }
        }
        
        this.connections.delete(key);
        this.connectionPromises.delete(key);
        console.log(`Closed connection to ${key}`);
    }

    async closeAllConnections() {
        console.log('Closing all connections...');
        
        const closePromises = Array.from(this.connections.keys()).map(key => 
            this.closeConnection(key).catch(error => 
                console.error(`Error closing ${key}:`, error.message)
            )
        );
        
        await Promise.all(closePromises);
        this.connections.clear();
        this.connectionPromises.clear();
    }

    getConnectionStats() {
        const stats = {
            total: this.connections.size,
            active: 0,
            idle: 0,
            connections: []
        };

        const now = Date.now();
        
        for (const [key, connection] of this.connections) {
            const idleTime = now - connection.lastUsed;
            const isActive = idleTime < 30000; // Active if used in last 30 seconds
            
            if (isActive) {
                stats.active++;
            } else {
                stats.idle++;
            }
            
            stats.connections.push({
                endpoint: key,
                lastUsed: new Date(connection.lastUsed).toISOString(),
                idleTime: Math.round(idleTime / 1000),
                status: isActive ? 'active' : 'idle'
            });
        }

        return stats;
    }

    startCleanup() {
        setInterval(() => {
            this.cleanupIdleConnections();
        }, this.cleanupInterval);
    }

    async cleanupIdleConnections() {
        const now = Date.now();
        const toRemove = [];

        for (const [key, connection] of this.connections) {
            const idleTime = now - connection.lastUsed;
            
            if (idleTime > this.maxIdleTime) {
                toRemove.push(key);
            }
        }

        if (toRemove.length > 0) {
            console.log(`Cleaning up ${toRemove.length} idle connections:`, toRemove);
            
            for (const key of toRemove) {
                try {
                    await this.closeConnection(key.split(':').join(':'));
                } catch (error) {
                    console.error(`Error during cleanup of ${key}:`, error.message);
                }
            }
        }
    }
}

module.exports = NodeInspectorConnectionPool;
