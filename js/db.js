import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = /^https:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;

export const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const BUCKET = 'materials';
// Supabase 무료 플랜의 파일 1개 업로드 한도
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
// 무료 플랜 저장 용량 (표시용)
export const STORAGE_QUOTA_BYTES = 1024 ** 3;
