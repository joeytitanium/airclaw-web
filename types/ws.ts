export interface WSResponse {
  type:
    | 'message'
    | 'pong'
    | 'status'
    | 'error'
    | 'stream_start'
    | 'stream_chunk'
    | 'stream_end';
  content?: string;
  messageId?: string;
  creditsUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  status?: string;
  error?: string;
  errorCode?: string;
}
