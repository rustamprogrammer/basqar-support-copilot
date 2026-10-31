declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    SUPPORT_ADMIN_PASSWORD?: string;
    SUPPORT_DEMO_MODE?: string;
    AI_REVIEW_ENABLED?: string;
  }
}
