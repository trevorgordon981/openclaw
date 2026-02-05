/**
 * Streaming Responses - Stream token output instead of waiting for full completion
 * - SSE (Server-Sent Events) support
 * - Configurable chunk sizes
 * - Better UX + lower memory usage
 */

import { EventEmitter } from "events";

export interface StreamConfig {
  chunkSize: number;
  encoding: BufferEncoding;
  flushInterval: number; // ms, for SSE heartbeat
  enableCompression: boolean;
}

export interface StreamChunk {
  id: string;
  type: "start" | "delta" | "end" | "error";
  data: string;
  index: number;
  timestamp: number;
}

export interface StreamMetadata {
  requestId: string;
  model: string;
  tokensProcessed: number;
  startTime: number;
  endTime?: number;
}

/**
 * Handles streaming of responses with SSE support
 */
export class StreamingHandler extends EventEmitter {
  private config: StreamConfig;
  private metadata: StreamMetadata;
  private buffer: string = "";
  private chunkIndex: number = 0;
  private startTime: number;

  constructor(requestId: string, model: string, config: Partial<StreamConfig> = {}) {
    super();
    this.config = {
      chunkSize: config.chunkSize ?? 50,
      encoding: config.encoding ?? "utf8",
      flushInterval: config.flushInterval ?? 100,
      enableCompression: config.enableCompression ?? false,
    };

    this.startTime = Date.now();
    this.metadata = {
      requestId,
      model,
      tokensProcessed: 0,
      startTime: this.startTime,
    };
  }

  /**
   * Start streaming session - emit start event
   */
  start(): StreamChunk {
    const chunk: StreamChunk = {
      id: `${this.metadata.requestId}-start`,
      type: "start",
      data: JSON.stringify({
        requestId: this.metadata.requestId,
        model: this.metadata.model,
      }),
      index: 0,
      timestamp: Date.now(),
    };

    this.emit("stream-start", chunk);
    return chunk;
  }

  /**
   * Add text to stream, buffer and emit when chunk size reached
   */
  write(text: string): StreamChunk | null {
    if (!text) return null;

    this.buffer += text;
    this.metadata.tokensProcessed += Math.ceil(text.length / 4); // Rough token estimate

    // Emit chunk when buffer reaches configured size
    if (this.buffer.length >= this.config.chunkSize) {
      return this.flush();
    }

    return null;
  }

  /**
   * Force flush buffer to emit chunk
   */
  flush(): StreamChunk | null {
    if (this.buffer.length === 0) return null;

    const chunk: StreamChunk = {
      id: `${this.metadata.requestId}-chunk-${this.chunkIndex}`,
      type: "delta",
      data: this.buffer,
      index: this.chunkIndex,
      timestamp: Date.now(),
    };

    this.buffer = "";
    this.chunkIndex++;

    this.emit("stream-delta", chunk);
    return chunk;
  }

  /**
   * End stream and emit final event
   */
  end(finalText?: string): StreamChunk {
    // Flush any remaining buffer
    if (finalText) {
      this.buffer += finalText;
    }

    if (this.buffer.length > 0) {
      this.flush();
    }

    const endTime = Date.now();
    this.metadata.endTime = endTime;

    const chunk: StreamChunk = {
      id: `${this.metadata.requestId}-end`,
      type: "end",
      data: JSON.stringify({
        tokensProcessed: this.metadata.tokensProcessed,
        duration: endTime - this.startTime,
        tokensPerSecond: Math.round(
          (this.metadata.tokensProcessed / (endTime - this.startTime)) * 1000,
        ),
      }),
      index: this.chunkIndex,
      timestamp: endTime,
    };

    this.emit("stream-end", chunk);
    return chunk;
  }

  /**
   * Emit error event
   */
  error(err: Error): StreamChunk {
    const chunk: StreamChunk = {
      id: `${this.metadata.requestId}-error`,
      type: "error",
      data: JSON.stringify({
        error: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      }),
      index: -1,
      timestamp: Date.now(),
    };

    this.emit("stream-error", chunk);
    return chunk;
  }

  /**
   * Format chunk as Server-Sent Event (SSE)
   */
  formatAsSSE(chunk: StreamChunk): string {
    const lines = [`id: ${chunk.id}`, `event: ${chunk.type}`, `data: ${JSON.stringify(chunk)}`];

    return lines.join("\n") + "\n\n";
  }

  /**
   * Get current metadata
   */
  getMetadata(): StreamMetadata {
    return this.metadata;
  }

  /**
   * For backwards compatibility - collect full response
   */
  async collectFull(): Promise<string> {
    return new Promise((resolve, reject) => {
      let collected = "";

      this.on("stream-delta", (chunk: StreamChunk) => {
        collected += chunk.data;
      });

      this.on("stream-end", () => {
        resolve(collected);
      });

      this.on("stream-error", (chunk: StreamChunk) => {
        reject(new Error(chunk.data));
      });
    });
  }
}

/**
 * Utility to convert readable stream to SSE events
 */
export function streamToSSE(
  readableStream: NodeJS.ReadableStream,
  requestId: string,
  model: string,
): EventEmitter {
  const handler = new StreamingHandler(requestId, model);
  handler.start();

  readableStream.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    handler.write(text);
  });

  readableStream.on("end", () => {
    handler.end();
  });

  readableStream.on("error", (err: Error) => {
    handler.error(err);
  });

  return handler;
}
