/**
 * BullMQ Queue Client
 *
 * Provides the DM processing queue and Redis connection for BullMQ.
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,    // 👈 1. 關閉定時 Ready Check/PING 探針
      keepAlive: 30000,           // 👈 2. 將 TCP 心跳拉長為 30 秒才發送一次
      enableOfflineQueue: true,  // 👈 3. 避免斷線時在背景離線積壓請求每 5 秒狂刷
      // 👈 加入這段：如果 Redis 斷線，第一次等待 10 秒，之後最多 30 秒才試圖重連一次
      autoResubscribe: true,      // 斷線恢復後自動恢復訂閱
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        const delay = Math.min(times * 10000, 30000);
        return delay;
      },
    });
  }
  return connection;
}

// ─── DM Queue ───────────────────────────────────────────────────────────────────

export type CommentSource = "WEBHOOK" | "POLLING";

export interface ProcessCommentJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  // Set when the comment came from an ad: the organic post the ad was made
  // from. Campaigns are bound to that post, so both ids have to be matched.
  originalMediaId?: string;
  requeueAttempt?: number;
  // Which path enqueued this comment. It is not copied to ProcessedComment or
  // used for reconciliation dedup.
  source?: CommentSource;
}

// Delivered when a user taps an opening DM's button — carries the reveal target.
export interface ProcessPostbackJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  fallback?: boolean;
  // Set on the delayed second pass of a follow-gate check. Instagram does not
  // report a brand-new follow immediately, so the first `false` is re-checked
  // later instead of rejecting the tap outright.
  followRecheck?: boolean;
  // How many delayed re-checks have run, counting this one. Absent on jobs
  // queued before re-checks were counted, where `followRecheck` meant one.
  followRecheckAttempt?: number;
}

// Scheduled after the link is delivered, to send the appreciation follow-up.
// Enqueued with a delay (followUpDelayMinutes) so it can fire later, not just
// immediately.
export interface ProcessFollowUpJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  userId: string;
  automationId: string;
  commenterName?: string | null;
}

// An inbound DM from a user. Campaigns with `dmTriggerEnabled` whose keywords
// match the text reply to the sender.
export interface ProcessMessageJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  messageId: string;
  messageText: string;
  senderId: string;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessFollowUpJob
  | ProcessMessageJob;

export const POSTBACK_JOB_NAME = "process-postback";
export const FOLLOWUP_JOB_NAME = "process-followup";
export const MESSAGE_JOB_NAME = "process-message";

let dmQueue: Queue<DmQueueJob> | null = null;

export function getDMQueue(): Queue<DmQueueJob> {
  if (!dmQueue) {
    dmQueue = new Queue<DmQueueJob>("dm-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 }, // 只保留最近 100 筆成功紀錄
        removeOnFail: { count: 100 },     // 只保留最近 100 筆失敗紀錄，避免堆積
        // Clear failed jobs shortly after they exhaust retries. Job ids are
        // deterministic (comment_<acct>_<id>), so a retained failed job would
        // block the polling reconciler from ever retrying that comment. Clearing
        // them lets a later sweep re-enqueue and try again once a transient
        // failure (e.g. an Instagram rate-limit window) has passed. Failure
        // detail is still preserved in DmLog.
        //removeOnFail: { age: 300, count: 2000 },
        attempts: 3,
        backoff: {
          type: "exponential",            // 👈 關鍵修復：將 custom 改為 exponential (指數退避)，避免 5 秒死重試
          delay: 10000,                   // 第一次重試等 10 秒，之後呈倍數拉長
        },
      },
    });
  }
  return dmQueue;
}
