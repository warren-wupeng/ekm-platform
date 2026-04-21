"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const redis_1 = require("../redis");
const util_1 = require("./util");
const utils_1 = require("../utils");
const debug = utils_1.Debug("cluster:subscriberGroup:shardedSubscriber");
class ShardedSubscriber {
    constructor(emitter, options) {
        this.emitter = emitter;
        this.started = false;
        this.instance = null;
        // Store listener references for cleanup
        this.messageListeners = new Map();
        this.onEnd = () => {
            this.started = false;
            this.emitter.emit("-node", this.instance, this.nodeKey);
        };
        this.onError = (error) => {
            this.emitter.emit("nodeError", error, this.nodeKey);
        };
        this.onMoved = () => {
            this.emitter.emit("moved");
        };
        this.instance = new redis_1.default({
            port: options.port,
            host: options.host,
            username: options.username,
            password: options.password,
            enableReadyCheck: false,
            connectionName: util_1.getConnectionName("ssubscriber", options.connectionName),
            lazyConnect: true,
            tls: options.tls,
            /**
             * Disable auto reconnection for subscribers.
             * The ClusterSubscriberGroup will handle the reconnection.
             */
            retryStrategy: null,
        });
        this.nodeKey = util_1.getNodeKey(options);
        // Register listeners
        this.instance.once("end", this.onEnd);
        this.instance.on("error", this.onError);
        this.instance.on("moved", this.onMoved);
        for (const event of ["smessage", "smessageBuffer"]) {
            const listener = (...args) => {
                this.emitter.emit(event, ...args);
            };
            this.messageListeners.set(event, listener);
            this.instance.on(event, listener);
        }
    }
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.started) {
                debug("already started %s", this.nodeKey);
                return;
            }
            try {
                yield this.instance.connect();
                debug("started %s", this.nodeKey);
                this.started = true;
            }
            catch (err) {
                debug("failed to start %s: %s", this.nodeKey, err);
                this.started = false;
                throw err; // Re-throw so caller knows it failed
            }
        });
    }
    stop() {
        this.started = false;
        if (this.instance) {
            this.instance.disconnect();
            this.instance.removeAllListeners();
            this.messageListeners.clear();
            this.instance = null;
        }
        debug("stopped %s", this.nodeKey);
    }
    /**
     * Checks if the subscriber is started and NOT explicitly disconnected.
     */
    isStarted() {
        var _a;
        const status = (_a = this.instance) === null || _a === void 0 ? void 0 : _a.status;
        const isDisconnected = status === "end" || status === "close" || !this.instance;
        return this.started && !isDisconnected;
    }
    getInstance() {
        return this.instance;
    }
    getNodeKey() {
        return this.nodeKey;
    }
}
exports.default = ShardedSubscriber;
