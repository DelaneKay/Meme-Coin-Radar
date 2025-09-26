import { Orchestrator } from './services/orchestrator';
declare const app: import("express-serve-static-core").Express;
declare const server: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
declare const wss: import("ws").Server<typeof import("ws"), typeof import("http").IncomingMessage>;
declare const orchestrator: Orchestrator;
export { app, server, wss, orchestrator };
//# sourceMappingURL=index.d.ts.map