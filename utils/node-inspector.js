const CDP = require('chrome-remote-interface');
const { EventEmitter } = require('events');

class NodeInspectorClient extends EventEmitter {
    constructor(host = 'localhost', port = 9229) {
        super();
        this.host = host;
        this.port = port;
        this.client = null;
    }

    async connect() {
        try {
            // Connect using chrome-remote-interface
            this.client = await CDP({
                host: this.host,
                port: this.port
            });

            console.log('Connected to Node.js Inspector');
            
            // Enable Runtime domain
            await this.client.Runtime.enable();
            
            // Enable Console domain for console output
            await this.client.Console.enable();
            
            // Set up event listeners
            this.client.Runtime.consoleAPICalled((params) => {
                this.emit('console', params);
            });
            
            this.client.Runtime.exceptionThrown((params) => {
                this.emit('exception', params);
            });
            
            this.client.on('disconnect', () => {
                console.log('Node.js Inspector connection closed');
                this.emit('disconnect');
            });

            console.log('Node.js Inspector initialized');
            
        } catch (error) {
            throw new Error(`Failed to connect to Node.js Inspector: ${error.message}`);
        }
    }

    async eval(expression) {
        const result = await this.client.Runtime.evaluate({
            expression,
            returnByValue: true,
            awaitPromise: true,
        });

        if (result.exceptionDetails) {
            const error = result.exceptionDetails.exception;
            throw new Error(error.description || 'Expression evaluation failed');
        }

        return result.result.value;
    }

    async getProcessInfo() {
        return this.eval(`({
            pid: process.pid,
            version: process.version,
            platform: process.platform,
            arch: process.arch,
            cwd: process.cwd(),
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage()
        })`);
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
    }
}

module.exports = NodeInspectorClient;
