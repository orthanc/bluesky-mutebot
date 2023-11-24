export const STATIC_CONTENT_BASE = process.env.IS_OFFLINE
  ? `http://localhost:8080`
  : '/static';
